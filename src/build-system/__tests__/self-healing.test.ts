import { FailureDetector } from '../failure-detector';
import { AutoRestartEngine } from '../auto-restart-engine';
import { AutoRepairEngine } from '../auto-repair-engine';
import { StateRecoveryManager } from '../state-recovery-manager';
import { SelfHealingOrchestrator } from '../self-healing-orchestrator';
import { BuildGraphEngine } from '../graph-engine';
import { BuildGraph, BuildProvenance } from '../types';

describe('Self-Healing Build System', () => {
  describe('FailureDetector', () => {
    let detector: FailureDetector;

    beforeEach(() => {
      detector = new FailureDetector();
    });

    it('should classify timeout when execution time is >2x historical average', () => {
      detector.recordExecutionTime('test-node', 100);
      const classification = detector.classifyFailure('test-node', 250);
      expect(classification).not.toBeNull();
      expect(classification?.category).toBe('timeout');
      expect(classification?.symptoms).toContain('execTimeExceeded');
    });

    it('should classify OOM crash', () => {
      const oomError = new Error('FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory');
      const classification = detector.classifyFailure('test-node', 50, oomError);
      expect(classification).not.toBeNull();
      expect(classification?.category).toBe('resource');
      expect(classification?.symptoms).toContain('oom');
      expect(classification?.anomalyScore).toBe(95);
    });

    it('should classify GPU OOM crash', () => {
      const gpuError = new Error('CUDA out of memory on device');
      const classification = detector.classifyFailure('test-node', 50, gpuError);
      expect(classification).not.toBeNull();
      expect(classification?.category).toBe('resource');
      expect(classification?.symptoms).toContain('gpuOom');
      expect(classification?.anomalyScore).toBe(95);
    });

    it('should classify dependency conflict', () => {
      const depError = new Error('Cannot find module "some-library"');
      const classification = detector.classifyFailure('test-node', 50, depError);
      expect(classification).not.toBeNull();
      expect(classification?.category).toBe('crash');
      expect(classification?.symptoms).toContain('dependencyConflict');
      expect(classification?.anomalyScore).toBe(90);
    });

    it('should classify lock contention', () => {
      const lockError = new Error('Resource busy or locked: eaddrinuse');
      const classification = detector.classifyFailure('test-node', 50, lockError);
      expect(classification).not.toBeNull();
      expect(classification?.category).toBe('resource');
      expect(classification?.symptoms).toContain('lockContention');
      expect(classification?.anomalyScore).toBe(80);
    });

    it('should use memory threshold to detect OOM', () => {
      const classification = detector.classifyFailure('test-node', 50, null, {
        memoryUsageBytes: 1.9 * 1024 * 1024 * 1024
      });
      expect(classification).not.toBeNull();
      expect(classification?.symptoms).toContain('oom');
    });
  });

  describe('AutoRestartEngine', () => {
    let restarter: AutoRestartEngine;

    beforeEach(() => {
      restarter = new AutoRestartEngine(3, 5, 100);
    });

    it('should allow restarts within budget and track attempts', () => {
      expect(restarter.shouldRestart('node1')).toBe(true);

      restarter.recordAttempt('node1');
      expect(restarter.getNodeAttempts('node1')).toBe(1);
      expect(restarter.getTotalBuildRetries()).toBe(1);

      restarter.recordAttempt('node1');
      restarter.recordAttempt('node1');

      expect(restarter.shouldRestart('node1')).toBe(false); // Max 3 node retries
    });

    it('should block restarts when total build retries are exhausted', () => {
      restarter.recordAttempt('node1');
      restarter.recordAttempt('node2');
      restarter.recordAttempt('node3');
      restarter.recordAttempt('node4');
      restarter.recordAttempt('node5');

      expect(restarter.shouldRestart('node6')).toBe(false); // Max 5 build retries
    });

    it('should compute exponential backoff with +/- 15% random jitter', () => {
      restarter.recordAttempt('node1'); // 1st retry
      const delay1 = restarter.getBackoffDelay('node1');
      // base delay is 100ms. 100 * 2^0 = 100ms. Jitter: 100 * [0.85, 1.15] => 85ms to 115ms.
      expect(delay1).toBeGreaterThanOrEqual(85);
      expect(delay1).toBeLessThanOrEqual(115);

      restarter.recordAttempt('node1'); // 2nd retry
      const delay2 = restarter.getBackoffDelay('node1');
      // 100 * 2^1 = 200ms. Jitter: 200 * [0.85, 1.15] => 170ms to 230ms.
      expect(delay2).toBeGreaterThanOrEqual(170);
      expect(delay2).toBeLessThanOrEqual(230);
    });
  });

  describe('AutoRepairEngine', () => {
    let repairer: AutoRepairEngine;

    beforeEach(() => {
      repairer = new AutoRepairEngine();
    });

    it('should dispatch OOM downscaling strategy', () => {
      const config = { parallelJobs: 4, memoryLimit: '2g' };
      const classification = {
        category: 'resource' as const,
        confidence: 0.9,
        anomalyScore: 95,
        symptoms: ['oom' as const]
      };

      const result = repairer.attemptRepair('node1', 'event1', classification, config);
      expect(result.success).toBe(true);
      expect(result.action.repair_type).toBe('oom-reduce-concurrency');
      expect(result.mutatedConfig.parallelJobs).toBe(2);
      expect(result.mutatedConfig.memoryLimit).toBe('4g');
    });

    it('should dispatch GPU fallback strategy', () => {
      const config = { runtime: 'gpu' };
      const classification = {
        category: 'resource' as const,
        confidence: 0.9,
        anomalyScore: 95,
        symptoms: ['gpuOom' as const]
      };

      const result = repairer.attemptRepair('node1', 'event1', classification, config);
      expect(result.success).toBe(true);
      expect(result.action.repair_type).toBe('gpu-fallback-cpu');
      expect(result.mutatedConfig.runtime).toBe('cpu');
    });

    it('should clear stale locks', () => {
      const config = { clearLocks: false };
      const classification = {
        category: 'resource' as const,
        confidence: 0.8,
        anomalyScore: 80,
        symptoms: ['lockContention' as const]
      };

      const result = repairer.attemptRepair('node1', 'event1', classification, config);
      expect(result.success).toBe(true);
      expect(result.mutatedConfig.clearLocks).toBe(true);
      expect(result.mutatedConfig.killOrphanedProcesses).toBe(true);
    });
  });

  describe('StateRecoveryManager', () => {
    let recovery: StateRecoveryManager;
    let nodeResults: Map<string, any>;

    beforeEach(() => {
      recovery = new StateRecoveryManager();
      nodeResults = new Map();
      nodeResults.set('node1', { status: 'succeeded' });
      nodeResults.set('node2', { status: 'succeeded' });
      nodeResults.set('node3', { status: 'succeeded' });
    });

    it('should create and retrieve checkpoints', () => {
      const checkpoint = recovery.createCheckpoint('build1', 'node2', 1, nodeResults);
      expect(checkpoint).toBeDefined();
      expect(checkpoint.node_results.node1).toEqual({ status: 'succeeded' });

      const latest = recovery.getLatestCheckpoint('build1');
      expect(latest).toBeDefined();
      expect(latest?.checkpoint_id).toBe(checkpoint.checkpoint_id);
    });

    it('should support Level 1 (Node) rollback', () => {
      const result = recovery.rollbackLevel1('build1', 'node2', nodeResults, false);
      expect(result.affectedNodes).toEqual(['node2']);
      expect(nodeResults.has('node2')).toBe(false);
      expect(nodeResults.has('node1')).toBe(true);
    });

    it('should support Level 1 rollback dry-run', () => {
      const result = recovery.rollbackLevel1('build1', 'node2', nodeResults, true);
      expect(result.affectedNodes).toEqual(['node2']);
      expect(result.committed).toBe(false);
      expect(nodeResults.has('node2')).toBe(true);
    });

    it('should support Level 2 (Subtree) rollback', () => {
      const dagNodes = [
        { id: 'node1', depends_on: [] },
        { id: 'node2', depends_on: ['node1'] },
        { id: 'node3', depends_on: ['node2'] }
      ];
      const result = recovery.rollbackLevel2('build1', 'node2', nodeResults, dagNodes, false);
      expect(result.affectedNodes).toContain('node2');
      expect(result.affectedNodes).toContain('node3');
      expect(nodeResults.has('node2')).toBe(false);
      expect(nodeResults.has('node3')).toBe(false);
      expect(nodeResults.has('node1')).toBe(true);
    });

    it('should support Level 3 (Build) rollback', () => {
      const result = recovery.rollbackLevel3('build1', nodeResults, false);
      expect(nodeResults.size).toBe(0);
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
              errorMessage: 'OOM error occurred'
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
      const restarter = engine.getSelfHealingOrchestrator().getRestarter();
      Object.assign(restarter, { baseDelayMs: 10 });

      const plan = engine.createExecutionPlan('build-005');
      const result = await engine.executePlan(plan, provenance);

      expect(result.success).toBe(true);

      const orchestrator = engine.getSelfHealingOrchestrator();
      const events = orchestrator.getFailureEvents();
      expect(events.length).toBe(1);
      expect(events[0].classification.symptoms).toContain('oom');

      const repairs = orchestrator.getRepairer().getRepairHistory();
      expect(repairs.length).toBe(1);
      expect(repairs[0].repair_type).toBe('oom-reduce-concurrency');
      expect(repairs[0].success).toBe(true);

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
      const restarter = engine.getSelfHealingOrchestrator().getRestarter();
      Object.assign(restarter, { baseDelayMs: 10 });

      const plan = engine.createExecutionPlan('build-006');
      const result = await engine.executePlan(plan, provenance);

      expect(result.success).toBe(false);

      const orchestrator = engine.getSelfHealingOrchestrator();
      expect(orchestrator.getState()).toBe('MANUAL_INTERVENTION');
      expect(orchestrator.getFailureEvents().length).toBeGreaterThan(1);
    });
  });
});
