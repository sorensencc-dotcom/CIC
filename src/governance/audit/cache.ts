import { AuditResult } from "../models";

export interface CacheClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export class AuditCache {
  private ttl = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(private redis: CacheClient) {}

  getKey(skillId: string, version: string, policyVersion: string): string {
    return `audit:${skillId}:${version}:${policyVersion}`;
  }

  async get(
    skillId: string,
    version: string,
    policyVersion: string
  ): Promise<{
    result: AuditResult;
    isStale: () => boolean;
  } | null> {
    const key = this.getKey(skillId, version, policyVersion);
    const cached = await this.redis.get(key);

    if (!cached) return null;

    try {
      const data = JSON.parse(cached) as AuditResult & { cached_at: string };
      const cached_at = new Date(data.cached_at);
      const now = new Date();
      const age_days = (now.getTime() - cached_at.getTime()) / (1000 * 60 * 60 * 24);

      // Remove cached_at before returning to match fresh audit results
      const { cached_at: _, ...result } = data;
      return {
        result: result as AuditResult,
        isStale: () => age_days > 7,
      };
    } catch (e) {
      console.error(`Failed to parse cached audit: ${e}`);
      return null;
    }
  }

  async set(result: AuditResult, policyVersion: string): Promise<void> {
    const key = this.getKey(result.skill_id, result.skill_version, policyVersion);
    const data = {
      ...result,
      cached_at: new Date().toISOString(),
    };

    try {
      await this.redis.setex(key, this.ttl, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to cache audit result: ${e}`);
      // Don't throw; cache failure is not critical
    }
  }

  async invalidate(skillId: string, version: string, policyVersion: string): Promise<void> {
    const key = this.getKey(skillId, version, policyVersion);
    try {
      await this.redis.del(key);
    } catch (e) {
      console.error(`Failed to invalidate cache: ${e}`);
    }
  }

  setTTL(days: number): void {
    this.ttl = days * 24 * 60 * 60;
  }
}
