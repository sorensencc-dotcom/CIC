export class AutoRestartEngine {
  private nodeRetries: Map<string, number> = new Map();
  private totalBuildRetries = 0;
  private readonly maxNodeRetries: number;
  private readonly maxBuildRetries: number;
  private readonly baseDelayMs: number;

  constructor(maxNodeRetries = 3, maxBuildRetries = 5, baseDelayMs = 1000) {
    this.maxNodeRetries = maxNodeRetries;
    this.maxBuildRetries = maxBuildRetries;
    this.baseDelayMs = baseDelayMs;
  }

  shouldRestart(nodeId: string): boolean {
    const nodeAttempts = this.nodeRetries.get(nodeId) || 0;
    if (nodeAttempts >= this.maxNodeRetries) {
      return false;
    }
    if (this.totalBuildRetries >= this.maxBuildRetries) {
      return false;
    }
    return true;
  }

  recordAttempt(nodeId: string): number {
    const nodeAttempts = (this.nodeRetries.get(nodeId) || 0) + 1;
    this.nodeRetries.set(nodeId, nodeAttempts);
    this.totalBuildRetries++;
    return nodeAttempts;
  }

  getBackoffDelay(nodeId: string): number {
    const attempts = this.nodeRetries.get(nodeId) || 0;
    if (attempts === 0) return 0;

    // Exponential backoff: base * 2 ^ (attempts - 1)
    const baseBackoff = this.baseDelayMs * Math.pow(2, attempts - 1);
    
    // Jitter: +/- 15% random variance to prevent retry storms
    const jitterFactor = 0.85 + Math.random() * 0.3;
    return Math.round(baseBackoff * jitterFactor);
  }

  getNodeAttempts(nodeId: string): number {
    return this.nodeRetries.get(nodeId) || 0;
  }

  getTotalBuildRetries(): number {
    return this.totalBuildRetries;
  }

  reset(): void {
    this.nodeRetries.clear();
    this.totalBuildRetries = 0;
  }
}
