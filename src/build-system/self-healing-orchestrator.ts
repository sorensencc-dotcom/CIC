// src/build-system/self-healing-orchestrator.ts

import { FailureDetector, FailureEvent } from './failure-detector';
import { AutoRestartEngine, RetryState } from './auto-restart-engine';
import { AutoRepairEngine, RepairPlan, RepairAction } from './auto-repair-engine';
import { StateRecoveryManager } from './state-recovery-manager';
import {
  OrchestratorState,
  EscalationEvent,
  ManualInterventionEvent,
  EventSink,
} from './self-healing-events';
import { MetricsRegistry } from './self-healing-metrics';
import { StateMachineLogger } from './state-machine-logger';

export interface OrchestratorConfig {
  anomalyThreshold: number; // below this, ignore
}

export interface OrchestratorContext {
  buildId: string;
  nodeId: string;
  nodeRetryCount: number;
  buildRetryCount: number;
  failureEvent?: FailureEvent;
  repairActionsApplied: RepairAction[];
  repairHooks: Omit<import('./auto-repair-engine').RepairExecutionContext, 'buildId' | 'nodeId'>;
}

export type NodeExecutor = () => Promise<unknown>;

export class SelfHealingOrchestrator {
  private state: OrchestratorState = 'RUNNING';
  private readonly failureEvents: FailureEvent[] = [];

  constructor(
    private readonly failureDetector: FailureDetector,
    private readonly autoRestartEngine: AutoRestartEngine,
    private readonly autoRepairEngine: AutoRepairEngine,
    private readonly stateRecoveryManager: StateRecoveryManager,
    private readonly eventSink: EventSink,
    private readonly metrics: MetricsRegistry,
    private readonly config: OrchestratorConfig,
    private readonly logger?: StateMachineLogger,
  ) {}

  getState(): OrchestratorState {
    return this.state;
  }

  getRestarter(): AutoRestartEngine {
    return this.autoRestartEngine;
  }

  getRepairer(): AutoRepairEngine {
    return this.autoRepairEngine;
  }

  getRecovery(): StateRecoveryManager {
    return this.stateRecoveryManager;
  }

  getFailureEvents(): FailureEvent[] {
    return this.failureEvents;
  }

  private transitionTo(to: OrchestratorState, ctx: OrchestratorContext) {
    const from = this.state;
    this.state = to;
    if (this.logger) {
      this.logger.log({
        buildId: ctx.buildId,
        nodeId: ctx.nodeId,
        from,
        to,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async runNode(
    ctx: OrchestratorContext,
    executeNode: NodeExecutor,
  ): Promise<unknown> {
    this.transitionTo('RUNNING', ctx);

    while (true) {
      try {
        const result = await executeNode();
        // success path
        this.transitionTo('RUNNING', ctx);
        return result;
      } catch (error) {
        this.transitionTo('DETECTING', ctx);

        const failure = this.failureDetector.detectCrash(
          {
            buildId: ctx.buildId,
            nodeId: ctx.nodeId,
            startTime: Date.now(), // refine with real timing
            timeoutMs: 0,
          },
          error as Error,
        );

        ctx.failureEvent = failure;
        this.failureEvents.push(failure);

        this.transitionTo('CLASSIFYING', ctx);

        // Record metrics for failure event
        this.metrics.failureEvents.inc({ category: failure.category, nodeId: ctx.nodeId });
        this.metrics.anomalyScores.observe(
          { category: failure.category },
          failure.anomalyScore,
        );

        if (failure.anomalyScore < this.config.anomalyThreshold) {
          // treat as transient, maybe log and continue
          const retryDecision = this.autoRestartEngine.decideRetry({
            nodeRetryCount: ctx.nodeRetryCount,
            buildRetryCount: ctx.buildRetryCount,
          });

          if (!retryDecision.shouldRetry) {
            this.transitionTo('ESCALATING', ctx);
            this.metrics.escalations.inc({ buildId: ctx.buildId, nodeId: ctx.nodeId });
            await this.escalate(ctx, 'Low anomaly but retry quotas exceeded');
            this.transitionTo('MANUAL_INTERVENTION', ctx);
            return Promise.reject(error);
          }

          // Record metrics for retry
          this.metrics.nodeRetries.inc({ nodeId: ctx.nodeId });
          this.metrics.buildRetries.inc({ buildId: ctx.buildId });

          await this.delay(retryDecision.delayMs);
          ctx.nodeRetryCount += 1;
          ctx.buildRetryCount += 1;
          this.transitionTo('RUNNING', ctx);
          continue;
        }

        this.transitionTo('ATTEMPTING_REPAIR', ctx);

        const plan: RepairPlan = this.autoRepairEngine.planRepair(failure);
        this.metrics.repairAttempts.inc({ buildId: ctx.buildId, nodeId: ctx.nodeId });
        await this.autoRepairEngine.executeRepair(
          {
            buildId: ctx.buildId,
            nodeId: ctx.nodeId,
            ...ctx.repairHooks
          },
          plan,
        );

        ctx.repairActionsApplied.push(...plan.actions);

        const retryDecision = this.autoRestartEngine.decideRetry({
          nodeRetryCount: ctx.nodeRetryCount,
          buildRetryCount: ctx.buildRetryCount,
        });

        if (!retryDecision.shouldRetry) {
          this.transitionTo('ESCALATING', ctx);
          this.metrics.escalations.inc({ buildId: ctx.buildId, nodeId: ctx.nodeId });
          await this.escalate(ctx, retryDecision.reason);
          this.transitionTo('MANUAL_INTERVENTION', ctx);
          return Promise.reject(error);
        }

        this.transitionTo('VALIDATING', ctx);

        // Record metrics for retry after repair
        this.metrics.nodeRetries.inc({ nodeId: ctx.nodeId });
        this.metrics.buildRetries.inc({ buildId: ctx.buildId });

        await this.delay(retryDecision.delayMs);
        ctx.nodeRetryCount += 1;
        ctx.buildRetryCount += 1;

        this.transitionTo('RUNNING', ctx);
        // loop back and re-run node
      }
    }
  }

  private async escalate(
    ctx: OrchestratorContext,
    reason: string,
  ): Promise<void> {
    const failure = ctx.failureEvent!;
    const escalationEvent: EscalationEvent = {
      type: 'ESCALATION',
      buildId: ctx.buildId,
      nodeId: ctx.nodeId,
      state: 'ESCALATING',
      failure,
      repairActionsApplied: ctx.repairActionsApplied,
      nodeRetryCount: ctx.nodeRetryCount,
      buildRetryCount: ctx.buildRetryCount,
      timestamp: new Date().toISOString(),
      escalationReason: reason,
      suggestedNextSteps: 'Inspect logs, consider manual rollback or node configuration change.',
    };

    await this.eventSink.emit(escalationEvent);
  }

  async requestManualIntervention(ctx: OrchestratorContext, owner?: string): Promise<void> {
    const failure = ctx.failureEvent!;
    const event: ManualInterventionEvent = {
      type: 'MANUAL_INTERVENTION',
      buildId: ctx.buildId,
      nodeId: ctx.nodeId,
      failure,
      repairActionsApplied: ctx.repairActionsApplied,
      nodeRetryCount: ctx.nodeRetryCount,
      buildRetryCount: ctx.buildRetryCount,
      timestamp: new Date().toISOString(),
      owner,
      notes: 'Manual intervention requested by orchestrator.',
    };

    this.metrics.manualInterventions.inc({ buildId: ctx.buildId, nodeId: ctx.nodeId });
    this.transitionTo('MANUAL_INTERVENTION', ctx);
    await this.eventSink.emit(event);
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
