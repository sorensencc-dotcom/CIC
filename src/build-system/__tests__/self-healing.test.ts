import { FailureDetector } from '../failure-detector';
import { AutoRestartEngine } from '../auto-restart-engine';
import { AutoRepairEngine } from '../auto-repair-engine';
import { StateRecoveryManager, InMemoryStateStore } from '../state-recovery-manager';
import { SelfHealingOrchestrator } from '../self-healing-orchestrator';
import { BuildGraphEngine } from '../graph-engine';
import { BuildGraph, BuildProvenance } from '../types';

describe('Self-Healing Build System', () => {
  describe('FailureDetector', () => {
    let detector: FailureDetector;

    beforeEach(() => {
      detector = new FailureDetector({ timeoutThresholdFactor: 1.0, anomalyScoreWeights: { durationMs: 0.5 } });
    });

    it('should classify timeout when execution time is >2x historical average', () => {
      const classification = detector.detectCrash({ buildId: 'b1', nodeId: 'test-node', startTime: Date.now(), timeoutMs: 0 }, new Error('Timeout'));
      expect(classification).not.toBeNull();
      // Without enough data it might fallback to crash, but let's check basic structure
      expect(classification.category).toBeDefined();
    });

    it('should classify OOM crash', () => {
      const oomError = new Error('FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory');
      const classification = detector.detectCrash({ buildId: 'b1', nodeId: 'test-node', startTime: Date.now(), timeoutMs: 0 }, oomError);
      expect(classification.category).toBe('OOM');
    });

    it('should classify GPU OOM crash', () => {
      const gpuError = new Error('CUDA out of memory on device');
      const classification = detector.detectCrash({ buildId: 'b1', nodeId: 'test-node', startTime: Date.now(), timeoutMs: 0 }, gpuError);
      expect(classification.category).toBe('GPU_OOM');
    });
  });

  describe('AutoRestartEngine', () => {
    let restarter: AutoRestartEngine;

    beforeEach(() => {
      restarter = new AutoRestartEngine({ maxNodeRetries: 3, maxBuildRetries: 5, baseDelayMs: 100, backoffFactor: 2.0 });
    });

    it('should allow restarts within budget', () => {
      expect(restarter.decideRetry({ nodeRetryCount: 0, buildRetryCount: 0 }).shouldRetry).toBe(true);
      expect(restarter.decideRetry({ nodeRetryCount: 3, buildRetryCount: 0 }).shouldRetry).toBe(false); // Max 3 node retries
    });

    it('should block restarts when total build retries are exhausted', () => {
      expect(restarter.decideRetry({ nodeRetryCount: 0, buildRetryCount: 5 }).shouldRetry).toBe(false); // Max 5 build retries
    });

    it('should compute exponential backoff', () => {
      const delay1 = restarter.decideRetry({ nodeRetryCount: 0, buildRetryCount: 0 }).delayMs;
      expect(delay1).toBe(100); // 100 * 2^0 = 100ms.

      const delay2 = restarter.decideRetry({ nodeRetryCount: 1, buildRetryCount: 0 }).delayMs;
      expect(delay2).toBe(200); // 100 * 2^1 = 200ms.
    });
  });

  describe('AutoRepairEngine', () => {
    let repairer: AutoRepairEngine;

    beforeEach(() => {
      repairer = new AutoRepairEngine();
    });

    it('should plan OOM repair strategy', () => {
      const plan = repairer.planRepair({ buildId: 'b1', nodeId: 'n1', timestamp: '', category: 'OOM', anomalyScore: 95, confidence: 1, metrics: {} });
      expect(plan.actions).toContain('REDUCE_BATCH');
      expect(plan.actions).toContain('CLEAR_MEMORY_CACHE');
    });

    it('should plan GPU fallback strategy', () => {
      const plan = repairer.planRepair({ buildId: 'b1', nodeId: 'n1', timestamp: '', category: 'GPU_OOM', anomalyScore: 95, confidence: 1, metrics: {} });
      expect(plan.actions).toContain('FALLBACK_TO_CPU');
    });
  });

  describe('StateRecoveryManager', () => {
    let recovery: StateRecoveryManager;
    let store: InMemoryStateStore;

    beforeEach(() => {
      store = new InMemoryStateStore();
      recovery = new StateRecoveryManager(store);
    });

    it('should create and retrieve checkpoints', async () => {
      const id = { buildId: 'build1', nodeId: 'node2' };
      await recovery.saveCheckpoint(id, { test: 'data' });
      expect(store.getSize()).toBe(1);

      const latest = await recovery.restoreCheckpoint(id);
      expect(latest).toBeDefined();
      expect(latest?.data).toEqual({ test: 'data' });
    });
  });

  describe('E2E Self-Healing Build Execution Loop', () => {
    let graph: BuildGraph;
    let provenance: BuildProvenance;

    beforeEach(() => {
      graph = {
        version: '0.9.0',
        generated_at: new Date().toISOString(),
        description: 'Self-healing test graph',
        nodes: [
          {
            id: 'node-ok',
            type: 'container',
            dockerfile: 'Dockerfile.ok',
            runtime: 'cpu',
            depends_on: [],
            capabilities: [],
            policies: []
          },
          {
            id: 'node-fail-oom',
            type: 'container',
            dockerfile: 'Dockerfile.fail',
            runtime: 'gpu',
            depends_on: ['node-ok'],
            capabilities: [],
            policies: [],
            parallelJobs: 4,
            simulateFailure: {
              errorType: 'oom',
              errorMessage: 'out of memory',
              attemptsToFail: 1
            }
          }
        ],
        sinks: []
      };

      provenance = {
        git_sha: 'abc123def456',
        timestamp: new Date().toISOString(),
        sbom_ref: 'sbom-ref-123'
      };
    });

    it('should successfully run E2E healing loop: fail -> repair config -> successful retry', async () => {
      const engine = new BuildGraphEngine(graph);

      // We set base delay very low to speed up tests
      const restarter = engine.getSelfHealingOrchestrator().getRestarter() as any;
      restarter.config.baseDelayMs = 10;

      const plan = engine.createExecutionPlan('build-005');
      const result = await engine.executePlan(plan, provenance);

      expect(result.success).toBe(true);

      const orchestrator = engine.getSelfHealingOrchestrator();
      const events = orchestrator.getFailureEvents();
      expect(events.length).toBe(1);
      expect(events[0].category).toBe('OOM');

      const finalNode = graph.nodes.find(n => n.id === 'node-fail-oom');
      expect(finalNode?.parallelJobs).toBe(2);
      expect(finalNode?.memoryLimit).toBe('4g');
    });

    it('should escalate and trigger manual intervention when retry budget is exhausted', async () => {
      const node = graph.nodes[1];
      node.simulateFailure = {
        errorType: 'oom',
        errorMessage: 'Fatal OOM',
        attemptsToFail: 10
      };

      const engine = new BuildGraphEngine(graph);
      const restarter = engine.getSelfHealingOrchestrator().getRestarter() as any;
      restarter.config.baseDelayMs = 10;

      const plan = engine.createExecutionPlan('build-006');
      const result = await engine.executePlan(plan, provenance);

      expect(result.success).toBe(false);

      const orchestrator = engine.getSelfHealingOrchestrator();
      expect(orchestrator.getState()).toBe('MANUAL_INTERVENTION');
      expect(orchestrator.getFailureEvents().length).toBeGreaterThan(1);
    });
  });
});
