import { SkillPolicies, calculateRiskScore, getPolicyById } from "../index";

describe("Policies", () => {
  describe("SkillPolicies", () => {
    it("should have 8 policies defined", () => {
      expect(SkillPolicies.length).toBe(8);
    });

    it("should have all required policy fields", () => {
      SkillPolicies.forEach((policy) => {
        expect(policy.id).toBeDefined();
        expect(policy.description).toBeDefined();
        expect(["low", "medium", "high"]).toContain(policy.severity);
        expect([
          "injection",
          "safety",
          "completeness",
          "scope",
        ]).toContain(policy.category);
        expect(policy.reaudit_interval_days).toBeGreaterThan(0);
        expect(policy.examples).toBeDefined();
        expect(policy.examples.pass).toBeDefined();
        expect(policy.examples.fail).toBeDefined();
      });
    });

    it("should have high-severity policies with deterministic checks", () => {
      const highSevere = SkillPolicies.filter((p) => p.severity === "high");
      expect(highSevere.length).toBeGreaterThan(0);

      highSevere.forEach((policy) => {
        if (policy.deterministic_check) {
          expect(["regex", "static_rule", "ast_pattern"]).toContain(
            policy.deterministic_check.type
          );
          expect(policy.deterministic_check.patterns.length).toBeGreaterThan(0);
        }
      });
    });

    it("should not have duplicate policy IDs", () => {
      const ids = SkillPolicies.map((p) => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe("calculateRiskScore", () => {
    it("should return 0 for empty policies", () => {
      const score = calculateRiskScore([]);
      expect(score).toBe(0);
    });

    it("should return 100 for all high-severity policies", () => {
      const highPolicies = SkillPolicies.filter((p) => p.severity === "high");
      const score = calculateRiskScore(highPolicies);
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThan(50);
    });

    it("should return lower score for low-severity policies", () => {
      const lowPolicies = SkillPolicies.filter((p) => p.severity === "low");
      const score = calculateRiskScore(lowPolicies);
      expect(score).toBeLessThan(20);
    });

    it("should normalize to 0-100 range", () => {
      SkillPolicies.forEach((policy) => {
        const score = calculateRiskScore([policy]);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });

    it("should prefer high-severity in mixed", () => {
      const lowPolicy = SkillPolicies.find((p) => p.severity === "low")!;
      const highPolicy = SkillPolicies.find((p) => p.severity === "high")!;

      const lowScore = calculateRiskScore([lowPolicy]);
      const highScore = calculateRiskScore([highPolicy]);

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe("getPolicyById", () => {
    it("should find policy by ID", () => {
      const policy = getPolicyById("PROMPT_INJECTION_PATTERNS");
      expect(policy).toBeDefined();
      expect(policy?.id).toBe("PROMPT_INJECTION_PATTERNS");
    });

    it("should return undefined for unknown policy", () => {
      const policy = getPolicyById("NONEXISTENT");
      expect(policy).toBeUndefined();
    });

    it("should find all defined policies", () => {
      SkillPolicies.forEach((policy) => {
        const found = getPolicyById(policy.id);
        expect(found).toEqual(policy);
      });
    });
  });

  describe("Policy Examples", () => {
    it("PROMPT_INJECTION_PATTERNS should be high severity", () => {
      const policy = getPolicyById("PROMPT_INJECTION_PATTERNS");
      expect(policy?.severity).toBe("high");
    });

    it("VAGUE_SCOPE should be low severity", () => {
      const policy = getPolicyById("VAGUE_SCOPE");
      expect(policy?.severity).toBe("low");
    });

    it("all policies should have at least one example", () => {
      SkillPolicies.forEach((policy) => {
        expect(policy.examples.pass.length).toBeGreaterThan(0);
        expect(policy.examples.fail.length).toBeGreaterThan(0);
      });
    });
  });
});
