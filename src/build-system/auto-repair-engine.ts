import { FailureClassification, RepairAction } from './types';

export class AutoRepairEngine {
  private repairHistory: RepairAction[] = [];

  attemptRepair(
    nodeId: string,
    eventId: string,
    classification: FailureClassification,
    nodeConfig: any
  ): { success: boolean; action: RepairAction; mutatedConfig: any } {
    const startTime = Date.now();
    const repairId = `repair-${startTime}-${Math.random().toString(36).slice(2, 9)}`;
    const params_before = JSON.parse(JSON.stringify(nodeConfig));
    const mutatedConfig = JSON.parse(JSON.stringify(nodeConfig));
    
    let success = false;
    let repairType = 'unknown';

    const { symptoms } = classification;

    if (symptoms.includes('oom')) {
      repairType = 'oom-reduce-concurrency';
      // Halve parallelism concurrency to reduce memory footprints
      mutatedConfig.parallelJobs = Math.max(1, Math.floor((params_before.parallelJobs || 4) / 2));
      mutatedConfig.memoryLimit = '4g'; // Upscale container limits if applicable
      success = true;
    } else if (symptoms.includes('gpuOom')) {
      repairType = 'gpu-fallback-cpu';
      mutatedConfig.runtime = 'cpu';
      success = true;
    } else if (symptoms.includes('lockContention')) {
      repairType = 'clear-stale-locks';
      mutatedConfig.clearLocks = true;
      mutatedConfig.killOrphanedProcesses = true;
      success = true;
    } else if (symptoms.includes('dependencyConflict')) {
      repairType = 'override-dependencies-pinned';
      mutatedConfig.usePinnedDependencies = true;
      success = true;
    } else if (symptoms.includes('execTimeExceeded')) {
      repairType = 'enable-caching';
      mutatedConfig.useCache = true;
      success = true;
    } else if (symptoms.includes('driftSignature')) {
      repairType = 'clean-build-force';
      mutatedConfig.cleanBuild = true;
      success = true;
    } else {
      // Fallback fallback
      repairType = 'generic-retry-reset';
      mutatedConfig.resetEnv = true;
      success = true;
    }

    const action: RepairAction = {
      repair_id: repairId,
      event_id: eventId,
      repair_type: repairType,
      params_before,
      params_after: mutatedConfig,
      success,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    this.repairHistory.push(action);
    return { success, action, mutatedConfig };
  }

  getRepairHistory(): RepairAction[] {
    return this.repairHistory;
  }
}
