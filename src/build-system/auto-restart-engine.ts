// src/build-system/auto-restart-engine.ts

export interface RetryConfig {
  maxNodeRetries: number;
  maxBuildRetries: number;
  baseDelayMs: number;
  backoffFactor: number; // e.g. 2.0
}

export interface RetryState {
  nodeRetryCount: number;
  buildRetryCount: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
}

export class AutoRestartEngine {
  constructor(private readonly config: RetryConfig) {}

  decideRetry(state: RetryState): RetryDecision {
    if (state.nodeRetryCount >= this.config.maxNodeRetries) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Node retry quota exceeded',
      };
    }

    if (state.buildRetryCount >= this.config.maxBuildRetries) {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Build retry quota exceeded',
      };
    }

    const delayMs = this.computeBackoffDelay(state.nodeRetryCount);

    return {
      shouldRetry: true,
      delayMs,
      reason: 'Retry allowed by quotas',
    };
  }

  private computeBackoffDelay(attemptIndex: number): number {
    const { baseDelayMs, backoffFactor } = this.config;
    return baseDelayMs * Math.pow(backoffFactor, attemptIndex);
  }
}
