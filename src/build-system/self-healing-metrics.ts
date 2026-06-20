// src/build-system/self-healing-metrics.ts

export interface Counter {
  inc(labels?: Record<string, string>, value?: number): void;
}

export interface Gauge {
  set(labels: Record<string, string>, value: number): void;
}

export interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
}

export interface MetricsRegistry {
  failureEvents: Counter;
  repairAttempts: Counter;
  escalations: Counter;
  manualInterventions: Counter;
  nodeRetries: Counter;
  buildRetries: Counter;
  anomalyScores: Histogram;
}

export class NoopMetricsRegistry implements MetricsRegistry {
  failureEvents = { inc: () => {} };
  repairAttempts = { inc: () => {} };
  escalations = { inc: () => {} };
  manualInterventions = { inc: () => {} };
  nodeRetries = { inc: () => {} };
  buildRetries = { inc: () => {} };
  anomalyScores = { observe: () => {} };
}
