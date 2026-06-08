import { SkillLineage, Database } from "../index";
import { AuditResult, GovernanceContext, Skill } from "../../models";

class MockDatabase implements Database {
  private tables: Map<string, Record<string, unknown>[]> = new Map();

  async insert(table: string, data: Record<string, unknown>): Promise<void> {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    this.tables.get(table)!.push(data);
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    // Mock implementation for test queries
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

    if (sql.includes("SELECT DISTINCT skill_id FROM skill_lineage")) {
      const lineage = this.tables.get("skill_lineage") || [];
      const policy = (params?.[0] as string)?.replace(/%/g, ""); // Strip SQL LIKE wildcards
      return lineage.filter((row) =>
        (row.policies_triggered as string).includes(policy)
      );
    }

    return [];
  }

  clear(): void {
    this.tables.clear();
  }

  getTable(name: string): Record<string, unknown>[] {
    return this.tables.get(name) || [];
  }
}

function createTestSkill(name: string): Skill {
  return {
    meta: {
      id: `skill-${name}`,
      name,
      version: "1.0.0",
    },
    content: "test content",
  };
}

function createTestAuditResult(skillId: string, verdict: "PASS" | "WARN" | "FAIL"): AuditResult {
  return {
    skill_id: skillId,
    skill_name: skillId.replace("skill-", ""),
    skill_version: "1.0.0",
    source: "Local",
    verdict,
    policies_triggered: verdict === "PASS" ? [] : [
      {
        id: "TEST_POLICY",
        description: "Test",
        severity: verdict === "FAIL" ? "high" : "low",
        category: "safety",
        reaudit_interval_days: 90,
        examples: { pass: [], fail: [] },
      },
    ],
    risk_score: verdict === "PASS" ? 0 : verdict === "WARN" ? 30 : 70,
    deterministic_flags: [],
    audit_timestamp: new Date().toISOString(),
    auditor_model: "deterministic",
    policy_version: "2.0",
    audit_duration_ms: 100,
    notes: [],
  };
}

function createTestContext(): GovernanceContext {
  return {
    skill_id: "skill-test",
    skill_name: "Test",
    skill_version: "1.0.0",
    source: "Local",
    intended_scope: "Test",
    has_access_to: [],
    requested_permissions: [],
    user_tier: "internal",
    is_bulk_operation: false,
    force_reaudit: false,
  };
}

describe("SkillLineage", () => {
  let lineage: SkillLineage;
  let db: MockDatabase;

  beforeEach(() => {
    db = new MockDatabase();
    lineage = new SkillLineage(db);
  });

  describe("record", () => {
    it("should append audit to lineage", async () => {
      const skill = createTestSkill("test");
      const audit = createTestAuditResult("skill-test", "PASS");
      const context = createTestContext();

      await lineage.record(skill, audit, context);

      const records = db.getTable("skill_lineage");
      expect(records.length).toBe(1);
      expect(records[0].skill_id).toBe("skill-test");
      expect(records[0].audit_verdict).toBe("PASS");
    });

    it("should record all audit fields", async () => {
      const skill = createTestSkill("test");
      const audit = createTestAuditResult("skill-test", "WARN");
      const context = createTestContext();

      await lineage.record(skill, audit, context);

      const records = db.getTable("skill_lineage");
      const record = records[0];

      expect(record.skill_name).toBe("test");
      expect(record.skill_version).toBe("1.0.0");
      expect(record.source).toBe("Local");
      expect(record.risk_score).toBe(30);
      expect(record.policy_version).toBe("2.0");
    });

    it("should be append-only (not update existing)", async () => {
      const skill = createTestSkill("test");
      const audit1 = createTestAuditResult("skill-test", "PASS");
      const audit2 = createTestAuditResult("skill-test", "WARN");
      const context = createTestContext();

      await lineage.record(skill, audit1, context);
      await lineage.record(skill, audit2, context);

      const records = db.getTable("skill_lineage");
      expect(records.length).toBe(2);
      expect(records[0].audit_verdict).toBe("PASS");
      expect(records[1].audit_verdict).toBe("WARN");
    });

    it("should serialize policies triggered as JSON", async () => {
      const skill = createTestSkill("test");
      const audit = createTestAuditResult("skill-test", "FAIL");
      const context = createTestContext();

      await lineage.record(skill, audit, context);

      const records = db.getTable("skill_lineage");
      expect(typeof records[0].policies_triggered).toBe("string");
      const parsed = JSON.parse(records[0].policies_triggered as string);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe("getAuditChain", () => {
    it("should return audit chain in chronological order", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();

      const audit1 = createTestAuditResult("skill-test", "PASS");
      const audit2 = createTestAuditResult("skill-test", "WARN");
      const audit3 = createTestAuditResult("skill-test", "PASS");

      // Add with delays to ensure different timestamps
      await lineage.record(skill, audit1, context);
      await new Promise((r) => setTimeout(r, 10));
      await lineage.record(skill, audit2, context);
      await new Promise((r) => setTimeout(r, 10));
      await lineage.record(skill, audit3, context);

      const chain = await lineage.getAuditChain("skill-test");

      expect(chain.length).toBe(3);
      expect(chain[0].verdict).toBe("PASS");
      expect(chain[1].verdict).toBe("WARN");
      expect(chain[2].verdict).toBe("PASS");
    });

    it("should return empty array for unknown skill", async () => {
      const chain = await lineage.getAuditChain("unknown-skill");
      expect(chain.length).toBe(0);
    });
  });

  describe("queryByPolicy", () => {
    it("should find skills by policy ID", async () => {
      const skill1 = createTestSkill("skill1");
      const skill2 = createTestSkill("skill2");
      const context = createTestContext();

      const audit1 = createTestAuditResult("skill-skill1", "FAIL");
      const audit2 = createTestAuditResult("skill-skill2", "PASS");

      await lineage.record(skill1, audit1, context);
      await lineage.record(skill2, audit2, context);

      // Only skill1 has TEST_POLICY triggered
      const skills = await lineage.queryByPolicy("TEST_POLICY");

      expect(skills).toContain("skill-skill1");
    });

    it("should support time range filtering", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();
      const audit = createTestAuditResult("skill-test", "WARN");

      await lineage.record(skill, audit, context);

      const now = new Date();
      const future = new Date(now.getTime() + 1000000);

      const skills = await lineage.queryByPolicy("TEST_POLICY", {
        start: new Date(now.getTime() - 1000000).toISOString(),
        end: future.toISOString(),
      });

      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe("detectDrift", () => {
    it("should detect when new policies are triggered", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();

      // First audit: PASS, no policies
      const audit1 = createTestAuditResult("skill-test", "PASS");
      await lineage.record(skill, audit1, context);

      // Second audit: WARN, with policy
      const audit2 = createTestAuditResult("skill-test", "WARN");
      await lineage.record(skill, audit2, context);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.has_drift).toBe(true);
      expect(drift.drift_timeline.length).toBeGreaterThan(0);
      expect(drift.drift_timeline[0].policies_added.length).toBeGreaterThan(0);
    });

    it("should detect when policies are removed", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();

      // First audit: WARN with policy
      const audit1 = createTestAuditResult("skill-test", "WARN");
      await lineage.record(skill, audit1, context);

      // Second audit: PASS, no policies
      const audit2 = createTestAuditResult("skill-test", "PASS");
      await lineage.record(skill, audit2, context);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.has_drift).toBe(true);
      expect(drift.drift_timeline[0].policies_removed.length).toBeGreaterThan(0);
    });

    it("should track risk score changes", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();

      const audit1 = createTestAuditResult("skill-test", "PASS");
      audit1.risk_score = 10;
      const audit2 = createTestAuditResult("skill-test", "FAIL");
      audit2.risk_score = 70;

      await lineage.record(skill, audit1, context);
      await lineage.record(skill, audit2, context);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.drift_timeline[0].risk_delta).toBeGreaterThan(0);
    });

    it("should return empty drift for stable audits", async () => {
      const skill = createTestSkill("test");
      const context = createTestContext();

      const audit1 = createTestAuditResult("skill-test", "PASS");
      const audit2 = createTestAuditResult("skill-test", "PASS");

      await lineage.record(skill, audit1, context);
      await lineage.record(skill, audit2, context);

      const drift = await lineage.detectDrift("skill-test");

      expect(drift.has_drift).toBe(false);
      expect(drift.drift_timeline.length).toBe(0);
    });
  });
});
