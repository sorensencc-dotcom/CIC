// Phase 1: Incremental roadmap update engine
// Computes deltas between planned and executed phases; coordinates with governance vault
// Feeds back into cost model and scheduler for adaptive planning

export interface RoadmapDelta {
  phaseId: string;
  plannedCost: number;
  actualCost: number;
  variance: number;
  variancePercent: number;
  reason?: string;
}

export interface RoadmapUpdate {
  timestamp: number;
  appliedDeltas: RoadmapDelta[];
  revisedSchedule: any[];
  governanceSignal?: string;
}

export class RoadmapDeltaSynthesizer {
  private deltaHistory: RoadmapDelta[] = [];

  constructor() {}

  synthesize(
    plannedPhases: string[],
    executedPhases: Map<string, any>,
    costActuals: Map<string, number>
  ): RoadmapUpdate {
    const deltas: RoadmapDelta[] = [];

    // Compute variance for each executed phase
    for (const [phaseId, executionData] of executedPhases) {
      const plannedCost = executionData.plannedCost || 0;
      const actualCost = costActuals.get(phaseId) || 0;
      const variance = actualCost - plannedCost;
      const variancePercent = plannedCost > 0 ? (variance / plannedCost) * 100 : 0;

      const reason = this.classifyVariance(variance, variancePercent);

      deltas.push({
        phaseId,
        plannedCost,
        actualCost,
        variance,
        variancePercent,
        reason,
      });

      this.deltaHistory.push({
        phaseId,
        plannedCost,
        actualCost,
        variance,
        variancePercent,
        reason,
      });
    }

    // Recompute revised schedule based on deltas
    const revisedSchedule = this.computeRevisedSchedule(plannedPhases, deltas);

    // Determine governance signal based on total variance
    const totalVariance = deltas.reduce((sum, d) => sum + d.variance, 0);
    const totalPlanned = deltas.reduce((sum, d) => sum + d.plannedCost, 0);
    const totalVariancePercent = totalPlanned > 0 ? (totalVariance / totalPlanned) * 100 : 0;

    let governanceSignal = undefined;
    if (totalVariancePercent > 20) {
      governanceSignal = 'HIGH_VARIANCE_ALERT';
    } else if (totalVariancePercent > 10) {
      governanceSignal = 'MEDIUM_VARIANCE_WARNING';
    }

    return {
      timestamp: Date.now(),
      appliedDeltas: deltas,
      revisedSchedule,
      governanceSignal,
    };
  }

  correlateWithGovernance(update: RoadmapUpdate, vaultRecord: any): RoadmapUpdate {
    // Enrich deltas with governance decisions
    const enrichedDeltas = update.appliedDeltas.map(delta => {
      const vaultDecision = vaultRecord?.decisions?.find(
        (d: any) => d.phaseId === delta.phaseId
      );

      return {
        ...delta,
        reason: vaultDecision?.reason || delta.reason,
      };
    });

    // Update governance signal if vault has overrides
    let signal = update.governanceSignal;
    if (vaultRecord?.escalationLevel === 'critical') {
      signal = 'GOVERNANCE_OVERRIDE_REQUIRED';
    }

    return {
      ...update,
      appliedDeltas: enrichedDeltas,
      governanceSignal: signal,
    };
  }

  async persistDelta(delta: RoadmapDelta, vaultStore: any): Promise<void> {
    if (!vaultStore) return;

    // Store delta in vault if available
    if (typeof vaultStore.append === 'function') {
      await vaultStore.append({
        event_type: 'ROADMAP_DELTA',
        phaseId: delta.phaseId,
        variance: delta.variance,
        variancePercent: delta.variancePercent,
        timestamp: Date.now(),
      });
    }
  }

  private classifyVariance(variance: number, variancePercent: number): string {
    if (variance > 0) {
      if (variancePercent > 30) return 'CRITICAL_OVERRUN';
      if (variancePercent > 15) return 'SIGNIFICANT_OVERRUN';
      return 'MINOR_OVERRUN';
    } else if (variance < 0) {
      if (variancePercent < -30) return 'EXCEPTIONAL_UNDERRUN';
      if (variancePercent < -15) return 'SIGNIFICANT_UNDERRUN';
      return 'MINOR_UNDERRUN';
    }
    return 'ON_TARGET';
  }

  private computeRevisedSchedule(plannedPhases: string[], deltas: RoadmapDelta[]): any[] {
    // Simple schedule adjustment: stretch phases with overruns
    const deltaMap = new Map(deltas.map(d => [d.phaseId, d]));

    return plannedPhases.map(phaseId => {
      const delta = deltaMap.get(phaseId);
      const stretchFactor = delta ? (delta.actualCost / delta.plannedCost) : 1;

      return {
        phaseId,
        baselineDuration: 300, // Default duration in minutes
        adjustedDuration: Math.ceil(300 * stretchFactor),
        stretchFactor,
      };
    });
  }
}
