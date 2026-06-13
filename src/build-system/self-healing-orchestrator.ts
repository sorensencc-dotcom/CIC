import { FailureDetector } from './failure-detector';
import { AutoRestartEngine } from './auto-restart-engine';
import { AutoRepairEngine } from './auto-repair-engine';
import { StateRecoveryManager } from './state-recovery-manager';
import { OrchestratorState, FailureClassification, FailureEvent } from './types';

export class SelfHealingOrchestrator {
  private detector = new FailureDetector();
  private restarter = new AutoRestartEngine();
  private repairer = new AutoRepairEngine();
  private recovery = new StateRecoveryManager();
  private state: OrchestratorState = 'RUNNING';
  private failureEvents: FailureEvent[] = [];

  getState(): OrchestratorState {
    return this.state;
  }

  getDetector(): FailureDetector { return this.detector; }
  getRestarter(): AutoRestartEngine { return this.restarter; }
  getRepairer(): AutoRepairEngine { return this.repairer; }
  getRecovery(): StateRecoveryManager { return this.recovery; }

  async handleFailure(
    nodeId: string,
    buildId: string,
    error: Error | null,
    nodeConfig: any,
    nodeResults: Map<string, any>,
    dagNodes: { id: string; depends_on: string[] }[],
    executionTimeMs?: number
  ): Promise<{ action: 'retry' | 'escalate'; backoffDelay?: number; mutatedConfig?: any }> {
    console.log(`[SelfHealing] Processing failure on node: ${nodeId}`);
    this.state = 'DETECTING';

    // 1. Detect & Classify
    const classification = this.detector.classifyFailure(nodeId, executionTimeMs || 500, error) || {
      category: 'crash' as const,
      confidence: 1.0,
      anomalyScore: 100,
      symptoms: ['noOutput' as const],
    };

    this.state = 'CLASSIFYING';
    const eventId = `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const failureEvent: FailureEvent = {
      event_id: eventId,
      build_id: buildId,
      node_id: nodeId,
      classification,
      error_message: error ? error.message : 'Unknown execution error',
      timestamp: new Date().toISOString(),
    };
    this.failureEvents.push(failureEvent);

    console.log(`[SelfHealing] Classification: ${classification.category} (Score: ${classification.anomalyScore}, Confidence: ${classification.confidence})`);

    // 2. Check retry budget limit
    if (!this.restarter.shouldRestart(nodeId)) {
      console.warn(`[SelfHealing] Retry budget exhausted for node ${nodeId} or build ${buildId}. Escalating.`);
      this.state = 'ESCALATING';
      this.state = 'MANUAL_INTERVENTION';
      return { action: 'escalate' };
    }

    // 3. Attempt Repair Strategy
    this.state = 'ATTEMPTING_REPAIR';
    const { success, action, mutatedConfig } = this.repairer.attemptRepair(
      nodeId,
      eventId,
      classification,
      nodeConfig
    );
    console.log(`[SelfHealing] Repair attempted: ${action.repair_type} (Success: ${success})`);

    // 4. Validate & Rollback
    this.state = 'VALIDATING';
    const attempt = this.restarter.recordAttempt(nodeId);
    const delay = this.restarter.getBackoffDelay(nodeId);

    // Dynamic rollback based on severity
    let rollbackResult;
    if (classification.category === 'drift' || classification.anomalyScore > 80) {
      console.log(`[SelfHealing] High anomaly detected. Performing Level 2 (Subtree) Rollback.`);
      rollbackResult = this.recovery.rollbackLevel2(buildId, nodeId, nodeResults, dagNodes);
    } else {
      console.log(`[SelfHealing] Low/Medium anomaly detected. Performing Level 1 (Node) Rollback.`);
      rollbackResult = this.recovery.rollbackLevel1(buildId, nodeId, nodeResults);
    }

    console.log(`[SelfHealing] Rollback complete. Affected nodes: ${rollbackResult.affectedNodes.join(', ')}`);

    // 5. Cooldown period to prevent thrashing
    this.state = 'COOLDOWN';
    const cooldownDelay = Math.min(1000, delay); // Cap at 1000ms for test fastness
    console.log(`[SelfHealing] Entering COOLDOWN state for ${cooldownDelay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, cooldownDelay));

    this.state = 'RUNNING';
    return {
      action: 'retry',
      backoffDelay: delay,
      mutatedConfig,
    };
  }

  getFailureEvents(): FailureEvent[] {
    return this.failureEvents;
  }
}
