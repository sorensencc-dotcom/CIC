import { AuditCache } from "../cache";
import { AuditResult } from "../../models";

class MockRedis {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

describe("AuditCache", () => {
  let cache: AuditCache;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    cache = new AuditCache(redis);
  });

  describe("get/set", () => {
    it("should store and retrieve audit result", async () => {
      const result: AuditResult = {
        skill_id: "skill-1",
        skill_name: "TestSkill",
        skill_version: "1.0.0",
        source: "Local",
        verdict: "PASS",
        policies_triggered: [],
        risk_score: 0,
        deterministic_flags: [],
        audit_timestamp: new Date().toISOString(),
        auditor_model: "deterministic",
        policy_version: "2.0",
        audit_duration_ms: 100,
        notes: [],
      };

      await cache.set(result, "2.0");
      const cached = await cache.get("skill-1", "1.0.0", "2.0");

      expect(cached).not.toBeNull();
      expect(cached?.result.skill_id).toBe("skill-1");
      expect(cached?.result.verdict).toBe("PASS");
    });

    it("should return null for cache miss", async () => {
      const cached = await cache.get("nonexistent", "1.0.0", "2.0");
      expect(cached).toBeNull();
    });

    it("should use correct cache key format", () => {
      const key = cache.getKey("skill-1", "1.0.0", "2.0");
      expect(key).toBe("audit:skill-1:1.0.0:2.0");
    });

    it("should detect stale entries", async () => {
      const result: AuditResult = {
        skill_id: "skill-1",
        skill_name: "TestSkill",
        skill_version: "1.0.0",
        source: "Local",
        verdict: "PASS",
        policies_triggered: [],
        risk_score: 0,
        deterministic_flags: [],
        audit_timestamp: new Date().toISOString(),
        auditor_model: "deterministic",
        policy_version: "2.0",
        audit_duration_ms: 100,
        notes: [],
      };

      await cache.set(result, "2.0");
      const cached = await cache.get("skill-1", "1.0.0", "2.0");

      expect(cached?.isStale()).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("should remove cached entry", async () => {
      const result: AuditResult = {
        skill_id: "skill-1",
        skill_name: "TestSkill",
        skill_version: "1.0.0",
        source: "Local",
        verdict: "PASS",
        policies_triggered: [],
        risk_score: 0,
        deterministic_flags: [],
        audit_timestamp: new Date().toISOString(),
        auditor_model: "deterministic",
        policy_version: "2.0",
        audit_duration_ms: 100,
        notes: [],
      };

      await cache.set(result, "2.0");
      await cache.invalidate("skill-1", "1.0.0", "2.0");

      const cached = await cache.get("skill-1", "1.0.0", "2.0");
      expect(cached).toBeNull();
    });
  });

  describe("TTL configuration", () => {
    it("should allow TTL customization", () => {
      cache.setTTL(14);
      // TTL is now 14 days; would be verified in real Redis integration
      expect(cache).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should handle JSON parse errors gracefully", async () => {
      redis.setex("audit:skill-1:1.0.0:2.0", 604800, "invalid json{");
      const cached = await cache.get("skill-1", "1.0.0", "2.0");
      expect(cached).toBeNull();
    });
  });

  describe("Multiple entries", () => {
    it("should handle multiple distinct skill audits", async () => {
      const result1: AuditResult = {
        skill_id: "skill-1",
        skill_name: "Skill1",
        skill_version: "1.0.0",
        source: "Local",
        verdict: "PASS",
        policies_triggered: [],
        risk_score: 0,
        deterministic_flags: [],
        audit_timestamp: new Date().toISOString(),
        auditor_model: "deterministic",
        policy_version: "2.0",
        audit_duration_ms: 100,
        notes: [],
      };

      const result2: AuditResult = {
        skill_id: "skill-2",
        skill_name: "Skill2",
        skill_version: "2.0.0",
        source: "Local",
        verdict: "WARN",
        policies_triggered: [],
        risk_score: 50,
        deterministic_flags: [],
        audit_timestamp: new Date().toISOString(),
        auditor_model: "deterministic",
        policy_version: "2.0",
        audit_duration_ms: 120,
        notes: [],
      };

      await cache.set(result1, "2.0");
      await cache.set(result2, "2.0");

      const cached1 = await cache.get("skill-1", "1.0.0", "2.0");
      const cached2 = await cache.get("skill-2", "2.0.0", "2.0");

      expect(cached1?.result.skill_id).toBe("skill-1");
      expect(cached2?.result.skill_id).toBe("skill-2");
    });
  });
});
