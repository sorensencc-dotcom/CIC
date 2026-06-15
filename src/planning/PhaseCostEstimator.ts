// Phase 1: Cost estimation engine for workload forecasting
// Estimates CPU, memory, network, disk per phase based on historical phase metrics
// Feeds into AutoschedulerV2 constraint solver

export interface PhaseCostEstimate {
  phaseId: string;
  cpu: { min: number; max: number; unit: string };
  memory: { min: number; max: number; unit: string };
  network: { egress: number; ingress: number; unit: string };
  disk: { read: number; write: number; unit: string };
  duration: { min: number; max: number; unit: string };
  confidence: 'low' | 'medium' | 'high';
}

export class PhaseCostEstimator {
  private estimates: Map<string, PhaseCostEstimate> = new Map();
  private historicalData: Map<string, PhaseCostEstimate[]> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    const phaseDefaults: Record<string, PhaseCostEstimate> = {
      'Phase 0.7': {
        phaseId: 'Phase 0.7',
        cpu: { min: 1, max: 4, unit: 'cores' },
        memory: { min: 2, max: 8, unit: 'GB' },
        network: { egress: 100, ingress: 50, unit: 'MB' },
        disk: { read: 500, write: 200, unit: 'MB/s' },
        duration: { min: 240, max: 480, unit: 'min' },
        confidence: 'high',
      },
      'Phase 1': {
        phaseId: 'Phase 1',
        cpu: { min: 2, max: 8, unit: 'cores' },
        memory: { min: 4, max: 16, unit: 'GB' },
        network: { egress: 200, ingress: 100, unit: 'MB' },
        disk: { read: 1000, write: 500, unit: 'MB/s' },
        duration: { min: 360, max: 720, unit: 'min' },
        confidence: 'medium',
      },
      'Phase 2': {
        phaseId: 'Phase 2',
        cpu: { min: 2, max: 6, unit: 'cores' },
        memory: { min: 4, max: 12, unit: 'GB' },
        network: { egress: 150, ingress: 80, unit: 'MB' },
        disk: { read: 800, write: 400, unit: 'MB/s' },
        duration: { min: 300, max: 600, unit: 'min' },
        confidence: 'medium',
      },
    };

    Object.entries(phaseDefaults).forEach(([phaseId, estimate]) => {
      this.estimates.set(phaseId, estimate);
      this.historicalData.set(phaseId, [estimate]);
    });
  }

  estimate(phaseId: string): PhaseCostEstimate {
    if (this.estimates.has(phaseId)) {
      return this.estimates.get(phaseId)!;
    }

    // Default fallback for unknown phases
    return {
      phaseId,
      cpu: { min: 1, max: 4, unit: 'cores' },
      memory: { min: 2, max: 8, unit: 'GB' },
      network: { egress: 100, ingress: 50, unit: 'MB' },
      disk: { read: 500, write: 200, unit: 'MB/s' },
      duration: { min: 240, max: 480, unit: 'min' },
      confidence: 'low',
    };
  }

  estimateBatch(phaseIds: string[]): Map<string, PhaseCostEstimate> {
    const batch = new Map<string, PhaseCostEstimate>();
    phaseIds.forEach(phaseId => {
      batch.set(phaseId, this.estimate(phaseId));
    });
    return batch;
  }

  updateFromActuals(phaseId: string, actual: PhaseCostEstimate): void {
    if (!this.historicalData.has(phaseId)) {
      this.historicalData.set(phaseId, []);
    }
    this.historicalData.get(phaseId)!.push(actual);

    // Recompute average estimate
    const history = this.historicalData.get(phaseId)!;
    const avgCpu = {
      min: history.reduce((sum, e) => sum + e.cpu.min, 0) / history.length,
      max: history.reduce((sum, e) => sum + e.cpu.max, 0) / history.length,
      unit: 'cores',
    };
    const avgMemory = {
      min: history.reduce((sum, e) => sum + e.memory.min, 0) / history.length,
      max: history.reduce((sum, e) => sum + e.memory.max, 0) / history.length,
      unit: 'GB',
    };
    const avgNetwork = {
      egress: history.reduce((sum, e) => sum + e.network.egress, 0) / history.length,
      ingress: history.reduce((sum, e) => sum + e.network.ingress, 0) / history.length,
      unit: 'MB',
    };
    const avgDisk = {
      read: history.reduce((sum, e) => sum + e.disk.read, 0) / history.length,
      write: history.reduce((sum, e) => sum + e.disk.write, 0) / history.length,
      unit: 'MB/s',
    };
    const avgDuration = {
      min: history.reduce((sum, e) => sum + e.duration.min, 0) / history.length,
      max: history.reduce((sum, e) => sum + e.duration.max, 0) / history.length,
      unit: 'min',
    };

    const confidence = history.length > 5 ? 'high' : history.length > 2 ? 'medium' : 'low';

    this.estimates.set(phaseId, {
      phaseId,
      cpu: avgCpu,
      memory: avgMemory,
      network: avgNetwork,
      disk: avgDisk,
      duration: avgDuration,
      confidence,
    });
  }
}
