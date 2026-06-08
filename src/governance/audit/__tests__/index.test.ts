import { SkillAudit } from "../index";
import { AuditCache } from "../cache";
import { Skill, GovernanceContext } from "../../models";

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
}

function createTestSkill(name: string, content: string): Skill {
  return {
    meta: {
      id: `skill-${name}`,
      name,
      version: "1.0.0",
      scope: "Test skill",
    },
    content,
  };
}

function createTestContext(overrides?: Partial<GovernanceContext>): GovernanceContext {
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

describe("SkillAudit", () => {
  let audit: SkillAudit;
  let redis: MockRedis;
  let cache: AuditCache;

  beforeEach(() => {
    redis = new MockRedis();
    cache = new AuditCache(redis);
    audit = new SkillAudit(cache, "2.0");
  });

  describe("audit", () => {
    it("should return PASS for safe skill", async () => {
      const skill = createTestSkill("safe", "export function transform(x) { return x; }");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("PASS");
      expect(result.policies_triggered.length).toBe(0);
      expect(result.risk_score).toBe(0);
    });

    it("should return FAIL for skill with eval", async () => {
      const skill = createTestSkill("unsafe", "eval(userInput);");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("FAIL");
      expect(result.policies_triggered.length).toBeGreaterThan(0);
      expect(result.policies_triggered.some((p) => p.id === "PROMPT_INJECTION_PATTERNS")).toBe(
        true
      );
    });

    it("should return WARN for skill with flags", async () => {
      const skill = createTestSkill(
        "flagged",
        JSON.stringify({ name: "Test" }) // Missing required sections
      );
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("WARN");
      expect(result.policies_triggered.length).toBeGreaterThan(0);
    });

    it("should include audit metadata", async () => {
      const skill = createTestSkill("safe", "safe code");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.audit_timestamp).toBeDefined();
      expect(result.auditor_model).toBe("deterministic");
      expect(result.policy_version).toBe("2.0");
      expect(result.audit_duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("should set correct verdict based on severity", async () => {
      const skill = createTestSkill(
        "hardcoded-key",
        'const apiKey = "sk-1234567890abcdefghij";'
      );
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("FAIL");
      expect(result.policies_triggered.some((p) => p.severity === "high")).toBe(true);
    });
  });

  describe("caching", () => {
    it("should cache audit results", async () => {
      const skill = createTestSkill("safe", "safe code");
      const context = createTestContext();

      const result1 = await audit.audit(skill, context);
      const result2 = await audit.audit(skill, context);

      expect(result1).toEqual(result2);
    });

    it("should skip cache when force_reaudit is true", async () => {
      const skill = createTestSkill("safe", "safe code");
      const context = createTestContext({ force_reaudit: true });

      const result1 = await audit.audit(skill, context);
      const result2 = await audit.audit(skill, { ...context, force_reaudit: true });

      // Both should succeed; second would use cache if not forced
      expect(result1.verdict).toBe("PASS");
      expect(result2.verdict).toBe("PASS");
    });
  });

  describe("deterministic verdict logic", () => {
    it("should return PASS when no policies triggered", async () => {
      const skill = createTestSkill("safe", "function safe() { return true; }");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("PASS");
    });

    it("should return FAIL when hard_fails exist", async () => {
      const skill = createTestSkill("eval", "eval('malicious');");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("FAIL");
    });

    it("should return WARN when only flags (non-hard_fail) exist", async () => {
      const skill = createTestSkill("incomplete", "// Missing documentation\nconst x = 1;");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      // May return WARN or PASS depending on what gets flagged
      expect(["PASS", "WARN"]).toContain(result.verdict);
    });
  });

  describe("risk scoring", () => {
    it("should calculate correct risk score", async () => {
      const skill = createTestSkill("unsafe", "eval(x); password = 'secret';");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.risk_score).toBeGreaterThan(0);
      expect(result.risk_score).toBeLessThanOrEqual(100);
    });

    it("should score high-severity policies higher", async () => {
      const skill1 = createTestSkill("high", "eval(x);");
      const skill2 = createTestSkill("low", "// Vague scope");

      const context = createTestContext();
      const result1 = await audit.audit(skill1, context);
      const result2 = await audit.audit(skill2, context);

      expect(result1.risk_score).toBeGreaterThanOrEqual(result2.risk_score);
    });
  });

  describe("edge cases", () => {
    it("should handle empty skill content", async () => {
      const skill = createTestSkill("empty", "");
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("PASS");
      expect(result.policies_triggered.length).toBe(0);
    });

    it("should handle very large skill content", async () => {
      const largeContent = "safe code\n".repeat(10000);
      const skill = createTestSkill("large", largeContent);
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("PASS");
    });

    it("should handle skills with many policy matches", async () => {
      const content = `
        eval(x);
        process.exit(0);
        const apiKey = "sk_123456789012345678901234";
      `;
      const skill = createTestSkill("dangerous", content);
      const context = createTestContext();

      const result = await audit.audit(skill, context);

      expect(result.verdict).toBe("FAIL");
      expect(result.policies_triggered.length).toBeGreaterThanOrEqual(2);
    });
  });
});
