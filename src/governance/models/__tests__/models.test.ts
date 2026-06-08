import {
  GovernancePolicy,
  AuditResult,
  GovernanceContext,
  Skill,
  GovernanceVerdict,
} from "../index";

describe("Governance Models", () => {
  describe("GovernancePolicy", () => {
    it("should have required fields", () => {
      const policy: GovernancePolicy = {
        id: "TEST_POLICY",
        description: "Test policy",
        severity: "high",
        category: "injection",
        reaudit_interval_days: 30,
        examples: {
          pass: ["safe example"],
          fail: ["unsafe example"],
        },
      };

      expect(policy.id).toBe("TEST_POLICY");
      expect(policy.severity).toBe("high");
      expect(policy.reaudit_interval_days).toBe(30);
    });

    it("should support deterministic checks", () => {
      const policy: GovernancePolicy = {
        id: "REGEX_POLICY",
        description: "Regex check",
        severity: "high",
        category: "safety",
        reaudit_interval_days: 30,
        deterministic_check: {
          type: "regex",
          patterns: ["eval"],
          always_fail: true,
        },
        examples: { pass: [], fail: [] },
      };

      expect(policy.deterministic_check).toBeDefined();
      expect(policy.deterministic_check?.type).toBe("regex");
    });
  });

  describe("AuditResult", () => {
    it("should have required fields", () => {
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

      expect(result.skill_id).toBe("skill-1");
      expect(result.verdict).toBe("PASS");
      expect(result.risk_score).toBe(0);
    });

    it("should support verdicts", () => {
      const verdicts: GovernanceVerdict[] = ["PASS", "WARN", "FAIL"];
      verdicts.forEach((verdict) => {
        expect(["PASS", "WARN", "FAIL"]).toContain(verdict);
      });
    });
  });

  describe("GovernanceContext", () => {
    it("should have required fields", () => {
      const context: GovernanceContext = {
        skill_id: "skill-1",
        skill_name: "TestSkill",
        skill_version: "1.0.0",
        source: "Local",
        intended_scope: "data transformation",
        has_access_to: ["file_system"],
        requested_permissions: [],
        user_tier: "internal",
        is_bulk_operation: false,
        force_reaudit: false,
      };

      expect(context.skill_id).toBe("skill-1");
      expect(context.user_tier).toBe("internal");
      expect(context.has_access_to).toContain("file_system");
    });
  });

  describe("Skill", () => {
    it("should have meta and content", () => {
      const skill: Skill = {
        meta: {
          id: "skill-1",
          name: "TestSkill",
          version: "1.0.0",
          scope: "Test",
        },
        content: "// Test content",
      };

      expect(skill.meta.id).toBe("skill-1");
      expect(skill.content).toBe("// Test content");
    });

    it("should support optional execute function", () => {
      const skill: Skill = {
        meta: {
          id: "skill-1",
          name: "TestSkill",
          version: "1.0.0",
        },
        content: "content",
        execute: async (input) => ({ output: input }),
      };

      expect(skill.execute).toBeDefined();
    });
  });
});
