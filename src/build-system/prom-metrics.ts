// src/build-system/prom-metrics.ts

import client from 'prom-client';
import { MetricsRegistry } from './self-healing-metrics';

export class PromMetricsRegistry implements MetricsRegistry {
  private failureEventsCounter: client.Counter<string>;
  private repairAttemptsCounter: client.Counter<string>;
  private escalationsCounter: client.Counter<string>;
  private manualInterventionsCounter: client.Counter<string>;
  private nodeRetriesCounter: client.Counter<string>;
  private buildRetriesCounter: client.Counter<string>;
  private anomalyScoresHistogram: client.Histogram<string>;

  constructor() {
    const register = client.register;

    this.failureEventsCounter = new client.Counter({
      name: 'cic_failure_events_total',
      help: 'Total number of failure events detected',
      labelNames: ['category', 'nodeId'],
      registers: [register],
    });

    this.repairAttemptsCounter = new client.Counter({
      name: 'cic_repair_attempts_total',
      help: 'Total number of repair attempts',
      labelNames: ['buildId', 'nodeId'],
      registers: [register],
    });

    this.escalationsCounter = new client.Counter({
      name: 'cic_escalations_total',
      help: 'Total number of escalations',
      labelNames: ['buildId', 'nodeId'],
      registers: [register],
    });

    this.manualInterventionsCounter = new client.Counter({
      name: 'cic_manual_interventions_total',
      help: 'Total number of manual interventions requested',
      labelNames: ['buildId', 'nodeId'],
      registers: [register],
    });

    this.nodeRetriesCounter = new client.Counter({
      name: 'cic_node_retries_total',
      help: 'Total node-level retries',
      labelNames: ['nodeId'],
      registers: [register],
    });

    this.buildRetriesCounter = new client.Counter({
      name: 'cic_build_retries_total',
      help: 'Total build-level retries',
      labelNames: ['buildId'],
      registers: [register],
    });

    this.anomalyScoresHistogram = new client.Histogram({
      name: 'cic_failure_anomaly_score',
      help: 'Distribution of failure anomaly scores',
      labelNames: ['category'],
      buckets: [0, 20, 40, 60, 80, 100],
      registers: [register],
    });
  }

  get failureEvents() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.failureEventsCounter.inc(labels, value),
    };
  }

  get repairAttempts() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.repairAttemptsCounter.inc(labels, value),
    };
  }

  get escalations() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.escalationsCounter.inc(labels, value),
    };
  }

  get manualInterventions() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.manualInterventionsCounter.inc(labels, value),
    };
  }

  get nodeRetries() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.nodeRetriesCounter.inc(labels, value),
    };
  }

  get buildRetries() {
    return {
      inc: (labels?: Record<string, string>, value?: number) =>
        this.buildRetriesCounter.inc(labels, value),
    };
  }

  get anomalyScores() {
    return {
      observe: (labels: Record<string, string>, value: number) =>
        this.anomalyScoresHistogram.observe(labels, value),
    };
  }
}
