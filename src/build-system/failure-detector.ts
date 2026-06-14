// src/build-system/failure-detector.ts

export type FailureCategory =
  | 'TIMEOUT'
  | 'CRASH'
  | 'DRIFT'
  | 'OOM'
  | 'GPU_OOM'
  | 'RESOURCE_SPIKE';

export interface FailureMetrics {
  durationMs?: number;
  cpuPercent?: number;
  memoryBytes?: number;
  gpuMemoryBytes?: number;
  ioWaitPercent?: number;
  expectedHash?: string;
  actualHash?: string;
}

export interface FailureEvent {
  buildId: string;
  nodeId: string;
  category: FailureCategory;
  anomalyScore: number; // 0–100
  confidence: number;   // 0–1
  metrics: FailureMetrics;
  timestamp: string;
  message?: string;
}

export interface ExecutionContext {
  buildId: string;
  nodeId: string;
  startTime: number;
  timeoutMs: number;
  expectedHash?: string;
}

export interface FailureDetectorConfig {
  timeoutThresholdFactor: number; // e.g. 1.0 = strict, >1.0 = lenient
  anomalyScoreWeights: Partial<Record<keyof FailureMetrics, number>>;
}

export class FailureDetector {
  constructor(private readonly config: FailureDetectorConfig) {}

  detectTimeout(ctx: ExecutionContext, endTime: number): FailureEvent | null {
    const durationMs = endTime - ctx.startTime;
    if (durationMs <= ctx.timeoutMs * this.config.timeoutThresholdFactor) {
      return null;
    }

    const metrics: FailureMetrics = { durationMs };
    const anomalyScore = this.computeAnomalyScore(metrics);
    const confidence = 0.9;

    return {
      buildId: ctx.buildId,
      nodeId: ctx.nodeId,
      category: 'TIMEOUT',
      anomalyScore,
      confidence,
      metrics,
      timestamp: new Date().toISOString(),
      message: `Node ${ctx.nodeId} exceeded timeout (${durationMs}ms > ${ctx.timeoutMs}ms)`,
    };
  }

  detectCrash(
    ctx: ExecutionContext,
    error: Error,
    metrics: Partial<FailureMetrics> = {},
  ): FailureEvent {
    const anomalyScore = Math.max(100, this.computeAnomalyScore(metrics));
    const confidence = 0.95;

    let category: FailureCategory = 'CRASH';
    if (error.message.toLowerCase().includes('cuda out of memory')) {
      category = 'GPU_OOM';
    } else if (error.message.toLowerCase().includes('out of memory')) {
      category = 'OOM';
    }

    return {
      buildId: ctx.buildId,
      nodeId: ctx.nodeId,
      category,
      anomalyScore,
      confidence,
      metrics,
      timestamp: new Date().toISOString(),
      message: `Node ${ctx.nodeId} crashed: ${error.message}`,
    };
  }

  detectDrift(
    ctx: ExecutionContext,
    expectedHash: string,
    actualHash: string,
  ): FailureEvent | null {
    if (expectedHash === actualHash) return null;

    const metrics: FailureMetrics = { expectedHash, actualHash };
    const anomalyScore = this.computeAnomalyScore(metrics);
    const confidence = 0.9;

    return {
      buildId: ctx.buildId,
      nodeId: ctx.nodeId,
      category: 'DRIFT',
      anomalyScore,
      confidence,
      metrics,
      timestamp: new Date().toISOString(),
      message: `Output drift detected for node ${ctx.nodeId}`,
    };
  }

  private computeAnomalyScore(metrics: Partial<FailureMetrics>): number {
    const weights = this.config.anomalyScoreWeights;
    let score = 0;

    for (const key of Object.keys(weights) as (keyof FailureMetrics)[]) {
      const weight = weights[key] ?? 0;
      const value = metrics[key];

      if (typeof value === 'number') {
        score += weight * this.normalizeMetric(value);
      }
    }

    return Math.min(100, Math.max(0, score));
  }

  private normalizeMetric(value: number): number {
    // Placeholder: plug in z-score or domain-specific normalization later
    return (Math.min(10, value) / 10) * 100;
  }
}
