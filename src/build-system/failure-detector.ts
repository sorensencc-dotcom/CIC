import { FailureClassification, SymptomType, FailureCategory } from './types';

export class FailureDetector {
  private historicalAverages: Map<string, number> = new Map();

  recordExecutionTime(nodeId: string, durationMs: number): void {
    const currentAvg = this.historicalAverages.get(nodeId) || 0;
    if (currentAvg === 0) {
      this.historicalAverages.set(nodeId, durationMs);
    } else {
      // 80% weight on history, 20% on new data
      this.historicalAverages.set(nodeId, currentAvg * 0.8 + durationMs * 0.2);
    }
  }

  getHistoricalAverage(nodeId: string): number {
    return this.historicalAverages.get(nodeId) || 500; // default to 500ms
  }

  classifyFailure(
    nodeId: string,
    executionTimeMs: number,
    error?: Error | null,
    resourceMetrics?: { cpuPercent?: number; memoryUsageBytes?: number; gpuMemoryUsageBytes?: number }
  ): FailureClassification | null {
    const symptoms: SymptomType[] = [];
    const avg = this.getHistoricalAverage(nodeId);

    // 1. Check for Timeout (Execution takes >2x historical average)
    if (executionTimeMs > avg * 2) {
      symptoms.push('execTimeExceeded');
    }

    // 2. Check for Error Symptoms
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('gpu out of memory') || msg.includes('cuda oom') || msg.includes('gpu oom') || msg.includes('out of memory on device')) {
        symptoms.push('gpuOom');
      } else if (msg.includes('out of memory') || msg.includes('oom') || msg.includes('heap limit') || msg.includes('allocation failed')) {
        symptoms.push('oom');
      } else if (msg.includes('dependency') || msg.includes('cannot find module') || msg.includes('version conflict') || msg.includes('unmet dependency')) {
        symptoms.push('dependencyConflict');
      } else if (msg.includes('lock') || msg.includes('resource busy') || msg.includes('eaddrinuse') || msg.includes('already in use')) {
        symptoms.push('lockContention');
      } else {
        symptoms.push('noOutput');
      }
    }

    // 3. Check for Resource Metrics
    if (resourceMetrics) {
      // Threshold memory OOM limit check (e.g. approaching 2GB limit)
      if (resourceMetrics.memoryUsageBytes && resourceMetrics.memoryUsageBytes > 1.8 * 1024 * 1024 * 1024) {
        symptoms.push('oom');
      }
      if (resourceMetrics.gpuMemoryUsageBytes && resourceMetrics.gpuMemoryUsageBytes > 4 * 1024 * 1024 * 1024) {
        symptoms.push('gpuOom');
      }
    }

    if (symptoms.length === 0) {
      return null;
    }

    // Determine default category, confidence, and anomaly scores
    let category: FailureCategory = 'crash';
    let confidence = 0.5;
    let anomalyScore = 50;

    if (symptoms.includes('oom') || symptoms.includes('gpuOom') || symptoms.includes('lockContention')) {
      category = 'resource';
      confidence = 0.9;
      anomalyScore = symptoms.includes('oom') || symptoms.includes('gpuOom') ? 95 : 80;
    } else if (symptoms.includes('execTimeExceeded')) {
      category = 'timeout';
      confidence = 0.85;
      anomalyScore = Math.min(100, Math.round((executionTimeMs / avg) * 20));
    } else if (symptoms.includes('dependencyConflict')) {
      category = 'crash';
      confidence = 0.95;
      anomalyScore = 90;
    } else if (error) {
      category = 'crash';
      confidence = 0.8;
      anomalyScore = 75;
    }

    return {
      category,
      confidence,
      anomalyScore,
      symptoms,
    };
  }
}
