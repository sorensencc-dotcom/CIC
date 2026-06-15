// Phase 2: Learning cost model - Extends Phase 1 PhaseCostEstimator with ML-based delta correction
// Supervised learning on Phase 1 estimates vs Phase 2 actuals
// Adjusts cost predictions with confidence scoring

import { PhaseCostEstimate, PhaseCostEstimator } from './PhaseCostEstimator';

export interface CostModelTrainingData {
  phaseId: string;
  estimated: PhaseCostEstimate;
  actual: PhaseCostEstimate;
  error: number;
  confidenceScore: number;
}

export class CostModel {
  private baseEstimator: PhaseCostEstimator;
  private trainingData: Map<string, CostModelTrainingData[]> = new Map();
  private confidenceThreshold: number = 0.75;
  private correctionFactors: Map<string, number> = new Map();
  private accuracyMetrics: { mape: number; rmse: number; r2: number } = {
    mape: Infinity,
    rmse: 0,
    r2: 0,
  };

  constructor(baseEstimator: PhaseCostEstimator) {
    this.baseEstimator = baseEstimator;
  }

  async train(trainingData: CostModelTrainingData[]): Promise<void> {
    for (const data of trainingData) {
      if (!this.trainingData.has(data.phaseId)) {
        this.trainingData.set(data.phaseId, []);
      }
      this.trainingData.get(data.phaseId)!.push(data);
    }

    // Recompute correction factors and accuracy metrics
    this.computeCorrectionFactors();
    this.computeAccuracyMetrics();
  }

  predict(phaseId: string): { estimate: PhaseCostEstimate; confidence: 'low' | 'medium' | 'high' } {
    const baseEstimate = this.baseEstimator.estimate(phaseId);
    const correctionFactor = this.correctionFactors.get(phaseId) || 1.0;

    // Apply correction factor to durations
    const correctedEstimate: PhaseCostEstimate = {
      ...baseEstimate,
      duration: {
        min: baseEstimate.duration.min * correctionFactor,
        max: baseEstimate.duration.max * correctionFactor,
        unit: baseEstimate.duration.unit,
      },
    };

    // Determine confidence based on training data availability and accuracy
    const trainingCount = this.trainingData.get(phaseId)?.length || 0;
    let confidence: 'low' | 'medium' | 'high' = 'low';

    if (trainingCount >= 5 && this.accuracyMetrics.mape < 15) {
      confidence = 'high';
    } else if (trainingCount >= 2 && this.accuracyMetrics.mape < 25) {
      confidence = 'medium';
    }

    return { estimate: correctedEstimate, confidence };
  }

  getMAPE(): number {
    return this.accuracyMetrics.mape;
  }

  getAccuracyMetrics(): { mape: number; rmse: number; r2: number } {
    return { ...this.accuracyMetrics };
  }

  private computeCorrectionFactors(): void {
    for (const [phaseId, dataPoints] of this.trainingData) {
      if (dataPoints.length === 0) continue;

      // Correction factor = average(actual/estimated)
      const ratios = dataPoints.map(d => {
        const estimatedDuration = d.estimated.duration.max;
        const actualDuration = d.actual.duration.max;
        return actualDuration > 0 ? actualDuration / estimatedDuration : 1;
      });

      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      this.correctionFactors.set(phaseId, avgRatio);
    }
  }

  private computeAccuracyMetrics(): void {
    const allErrors: number[] = [];
    const allActuals: number[] = [];
    const allPredicted: number[] = [];

    for (const dataPoints of this.trainingData.values()) {
      for (const data of dataPoints) {
        const actual = data.actual.duration.max;
        const estimated = data.estimated.duration.max;
        const error = Math.abs(actual - estimated);

        allErrors.push(error);
        allActuals.push(actual);
        allPredicted.push(estimated);
      }
    }

    if (allErrors.length === 0) return;

    // MAPE: Mean Absolute Percentage Error
    const mape =
      (allErrors.reduce((sum, error, idx) => {
        return sum + (allActuals[idx] > 0 ? (error / allActuals[idx]) * 100 : 0);
      }, 0) / allErrors.length) || 0;

    // RMSE: Root Mean Squared Error
    const rmse = Math.sqrt(allErrors.reduce((sum, e) => sum + e * e, 0) / allErrors.length);

    // R²: Coefficient of determination
    const meanActual = allActuals.reduce((a, b) => a + b, 0) / allActuals.length;
    const ssRes = allActuals.reduce((sum, actual, idx) => {
      return sum + Math.pow(actual - allPredicted[idx], 2);
    }, 0);
    const ssTot = allActuals.reduce((sum, actual) => {
      return sum + Math.pow(actual - meanActual, 2);
    }, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    this.accuracyMetrics = { mape, rmse, r2 };
  }
}
