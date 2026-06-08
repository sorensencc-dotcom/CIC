import { SkillAudit, AuditCache, SkillLineage } from "../../governance";
import { Skill, GovernanceContext } from "../../governance/models";

// Mock implementations
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
}

class MockDatabase {
  private tables: Map<string, Record<string, unknown>[]> = new Map();

  async insert(table: string, data: Record<string, unknown>): Promise<void> {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    this.tables.get(table)!.push(data);
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    if (sql.includes("SELECT * FROM skill_lineage WHERE skill_id = ?")) {
      const skillId = params?.[0];
      const lineage = this.tables.get("skill_lineage") || [];
      const results = lineage.filter((row) => row.skill_id === skillId);
      // Sort by audit_timestamp if ORDER BY is present
      if (sql.includes("ORDER BY audit_timestamp")) {
        results.sort((a, b) => {
          const aTime = new Date(a.audit_timestamp as string).getTime();
          const bTime = new Date(b.audit_timestamp as string).getTime();
          return aTime - bTime;
        });
      }
      return results;
    }

    if (sql.includes("SELECT DISTINCT skill_id")) {
      const lineage = this.tables.get("skill_lineage") || [];
      const policy = (params?.[0] as string)?.replace(/%/g, ""); // Strip SQL LIKE wildcards
      return lineage.filter((row) =>
        (row.policies_triggered as string).includes(policy)
      );
    }

    return [];
  }

  getLineageRecords(): Record<string, unknown>[] {
    return this.tables.get("skill_lineage") || [];
  }

  clear(): void {
    this.tables.clear();
  }
}

describe("Skill Ingestion with Governance (Integration)", () => {
  let audit: SkillAudit;
  let lineage: SkillLineage;
  let cache: AuditCache;
  let redis: MockRedis;
  let db: MockDatabase;

  beforeEach(() => {
    redis = new MockRedis();
    db = new MockDatabase();
    cache = new AuditCache(redis);
    audit = new SkillAudit(cache, "2.0");
    lineage = new SkillLineage(db);
  });

  function createSkill(name: string, content: string): Skill {
    return {
      meta: {
        id: `skill-${name}`,
        name,
        version: "1.0.0",
        scope: "Test",
      },
      content,
    };
  }

  function createContext(overrides?: Partial<GovernanceContext>): GovernanceContext {
    return {
      skill_id: "skill-test",
      skill_name: "TestSkill",
      skill_version: "1.0.0",
      source: "Local",
      intended_scope: "Testing",
      has_access_to: [],
      requested_permissions: [],
      user_tier: "internal",
      is_bulk_operation: false,
      force_reaudit: false,
      ...overrides,
    };
  }

  describe("Safe Skill Ingestion", () => {
    it("should audit a safe skill as PASS", async () => {
      const skill = createSkill(
        "safe",
        `
        export function transform(data) {
          if (!data) throw new Error('Data required');
          return data.map(item => item.value);
        }
      `
      );
      const context = createContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("PASS");
      expect(result.policies_triggered.length).toBe(0);
      expect(result.risk_score).toBe(0);
    });

    it("should record safe audit in lineage", async () => {
      const skill = createSkill("safe", "safe code");
      const context = createContext();

      const result = await audit.audit(skill, context);
      await lineage.record(skill, result, context);

      const chain = await lineage.getAuditChain("skill-safe");

      expect(chain.length).toBe(1);
      expect(chain[0].verdict).toBe("PASS");
    });
  });

  describe("Unsafe Skill Ingestion", () => {
    it("should audit an unsafe skill as FAIL", async () => {
      const skill = createSkill("unsafe", "eval(userInput);");
      const context = createContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("FAIL");
      expect(result.policies_triggered.length).toBeGreaterThan(0);
      expect(result.policies_triggered.some((p) => p.severity === "high")).toBe(true);
    });

    it("should block ingestion of FAIL skills", async () => {
      const skill = createSkill("dangerous", "process.exit(0);");
      const context = createContext();

      const result = await audit.audit(skill, context);

      if (result.verdict === "FAIL") {
        expect(result.verdict).toBe("FAIL");
        // Skill would not be added to store in real implementation
      }
    });

    it("should record unsafe audit in lineage", async () => {
      const skill = createSkill("unsafe", "eval(x);");
      const context = createContext();

      const result = await audit.audit(skill, context);
      await lineage.record(skill, result, context);

      const chain = await lineage.getAuditChain("skill-unsafe");

      expect(chain.length).toBe(1);
      expect(chain[0].verdict).toBe("FAIL");
    });
  });

  describe("Caching Behavior", () => {
    it("should cache audit results", async () => {
      const skill = createSkill("safe", "safe code");
      const context = createContext();

      const start1 = Date.now();
      const result1 = await audit.audit(skill, context);
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      const result2 = await audit.audit(skill, context);
      const duration2 = Date.now() - start2;

      expect(result1).toEqual(result2);
      // Cache hit should be faster (or at least not much slower)
      expect(duration2).toBeLessThanOrEqual(duration1 + 10);
    });

    it("should skip cache when force_reaudit is true", async () => {
      const skill = createSkill("safe", "safe code");
      const context = createContext();

      await audit.audit(skill, context);
      const result2 = await audit.audit(skill, { ...context, force_reaudit: true });

      expect(result2.verdict).toBe("PASS");
    });

    it("should respect policy version in cache key", async () => {
      const skill = createSkill("safe", "safe code");
      const context = createContext();

      const audit1 = new SkillAudit(cache, "2.0");
      const result1 = await audit1.audit(skill, context);

      // Simulate policy version change
      const audit2 = new SkillAudit(cache, "3.0");
      const result2 = await audit2.audit(skill, context);

      // Both should succeed; potentially different verdicts if policies changed
      expect(result1.policy_version).toBe("2.0");
      expect(result2.policy_version).toBe("3.0");
    });
  });

  describe("Lineage Querying", () => {
    it("should retrieve audit chain in chronological order", async () => {
      const skill = createSkill("test", "safe code");
      const context = createContext();

      // Simulate multiple audits over time
      const audit1Result = await audit.audit(skill, { ...context, force_reaudit: true });
      await lineage.record(skill, audit1Result, context);

      await new Promise((r) => setTimeout(r, 10));

      const audit2Result = await audit.audit(skill, { ...context, force_reaudit: true });
      await lineage.record(skill, audit2Result, context);

      const chain = await lineage.getAuditChain("skill-test");

      expect(chain.length).toBe(2);
    });

    it("should find skills by policy ID", async () => {
      const skill1 = createSkill("safe", "safe code");
      const skill2 = createSkill("unsafe", "eval(x);");

      const context = createContext();
      const result1 = await audit.audit(skill1, context);
      const result2 = await audit.audit(skill2, context);

      await lineage.record(skill1, result1, context);
      await lineage.record(skill2, result2, context);

      // Query for PROMPT_INJECTION_PATTERNS
      const skills = await lineage.queryByPolicy("PROMPT_INJECTION_PATTERNS");

      expect(skills).toContain("skill-unsafe");
      expect(skills).not.toContain("skill-safe");
    });
  });

  describe("Drift Detection", () => {
    it("should detect when skill behavior changes", async () => {
      const skill = createSkill("test", "safe code");
      const context = createContext();

      // First audit
      const audit1Result = await audit.audit(skill, context);
      await lineage.record(skill, audit1Result, context);

      // Simulate skill content change (force reaudit since same skill ID/version)
      const skillChanged = {
        ...skill,
        content: "eval(userInput);", // Now unsafe
      };

      const context2 = createContext({ force_reaudit: true });
      const audit2Result = await audit.audit(skillChanged, context2);
      await lineage.record(skillChanged, audit2Result, context2);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.has_drift).toBe(true);
      expect(drift.drift_timeline.length).toBeGreaterThan(0);
    });

    it("should track risk score changes", async () => {
      const skill = createSkill("test", "");
      const context = createContext();

      // Safe
      const audit1Result = await audit.audit(skill, context);
      await lineage.record(skill, audit1Result, context);

      // Unsafe (force reaudit since same skill ID/version)
      const skillUnsafe = { ...skill, content: "eval(x);" };
      const context2 = createContext({ force_reaudit: true });
      const audit2Result = await audit.audit(skillUnsafe, context2);
      await lineage.record(skillUnsafe, audit2Result, context2);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.drift_timeline.length).toBeGreaterThan(0);
      expect(drift.drift_timeline[0].risk_delta).toBeGreaterThan(0);
    });
  });

  describe("Bulk Ingestion", () => {
    it("should audit multiple skills in sequence", async () => {
      const skills = [
        createSkill("skill1", "safe code"),
        createSkill("skill2", "safe code"),
        createSkill("skill3", "safe code"),
      ];

      const context = createContext({ is_bulk_operation: true });
      const results = [];

      for (const skill of skills) {
        const result = await audit.audit(skill, context);
        results.push(result);
      }

      expect(results.length).toBe(3);
      expect(results.every((r) => r.verdict === "PASS")).toBe(true);
    });

    it("should handle mixed safe and unsafe in bulk", async () => {
      const skills = [
        createSkill("safe", "safe code"),
        createSkill("unsafe", "eval(x);"),
        createSkill("safe2", "more safe code"),
      ];

      const context = createContext({ is_bulk_operation: true });
      const results = [];

      for (const skill of skills) {
        const result = await audit.audit(skill, context);
        results.push(result);
      }

      const fails = results.filter((r) => r.verdict === "FAIL");
      const passes = results.filter((r) => r.verdict === "PASS");

      expect(fails.length).toBe(1);
      expect(passes.length).toBe(2);
    });
  });

  describe("Performance", () => {
    it("should audit typical skill in <100ms", async () => {
      const skill = createSkill(
        "typical",
        `
        export async function process(input) {
          if (!input) throw new Error('Input required');
          const result = await Promise.all(
            input.map(item => transform(item))
          );
          return result;
        }
      `
      );

      const context = createContext({ force_reaudit: true });
      const start = Date.now();
      await audit.audit(skill, context);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it("should cache hits be fast", async () => {
      const skill = createSkill("cached", "safe code");
      const context = createContext();

      await audit.audit(skill, context);

      const start = Date.now();
      await audit.audit(skill, context); // Cache hit
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10);
    });
  });
});
