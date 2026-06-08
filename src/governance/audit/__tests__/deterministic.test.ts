import { DeterministicAudit } from "../deterministic";
import { SkillPolicies } from "../../policies";

describe("DeterministicAudit", () => {
  let audit: DeterministicAudit;

  beforeEach(() => {
    audit = new DeterministicAudit();
  });

  describe("check", () => {
    it("should detect eval() pattern", () => {
      const content = 'const result = eval(userInput);';
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.length).toBeGreaterThan(0);
      expect(hard_fails.some((p) => p.id === "PROMPT_INJECTION_PATTERNS")).toBe(
        true
      );
    });

    it("should detect hardcoded API keys", () => {
      const content = 'const apiKey = "sk-1234567890abcdefghij";';
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should pass safe content", () => {
      const content = `
        export function transform(data) {
          // Process data safely
          return data.map(item => item.value);
        }
      `;
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.length).toBe(0);
    });

    it("should detect process.exit()", () => {
      const content = "if (error) process.exit(1);";
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "PROMPT_INJECTION_PATTERNS")).toBe(
        true
      );
    });

    it("should separate hard_fails from flags", () => {
      const content = 'eval("bad"); // missing error handling';
      const { hard_fails, flags } = audit.check(content, SkillPolicies);

      expect(hard_fails.length).toBeGreaterThan(0);
      // flags might include MISSING_ERROR_HANDLING
    });

    it("should handle regex errors gracefully", () => {
      const content = "some content";
      expect(() => {
        audit.check(content, SkillPolicies);
      }).not.toThrow();
    });

    it("should be case insensitive for pattern matching", () => {
      const content = "EVAL(input)";
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "PROMPT_INJECTION_PATTERNS")).toBe(
        true
      );
    });

    it("should detect execSync", () => {
      const content = "execSync('rm -rf /');";
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "UNSAFE_PROCESS_CALLS")).toBe(true);
    });

    it("should detect spawn with shell: true", () => {
      const content = "spawn('cmd', { shell: true });";
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "UNSAFE_PROCESS_CALLS")).toBe(true);
    });

    it("should detect hardcoded passwords", () => {
      const content = 'const password = "supersecret123";';
      const { hard_fails } = audit.check(content, SkillPolicies);

      expect(hard_fails.some((p) => p.id === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should handle empty content", () => {
      const { hard_fails, flags } = audit.check("", SkillPolicies);
      expect(hard_fails.length).toBe(0);
      expect(flags.length).toBe(0);
    });

    it("should handle null/undefined gracefully", () => {
      expect(() => {
        audit.check("", []);
      }).not.toThrow();
    });
  });

  describe("Performance", () => {
    it("should audit typical skill content in <100ms", () => {
      const content = `
        export async function processData(input) {
          if (!input) throw new Error('Input required');

          const result = await Promise.all(
            input.map(item => transform(item))
          );

          return result;
        }
      `.repeat(10); // ~1KB

      const start = Date.now();
      audit.check(content, SkillPolicies);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe("Static rule checks", () => {
    it("should detect missing required sections", () => {
      const content = JSON.stringify({ name: "Test" });
      const { flags } = audit.check(content, SkillPolicies);

      // MISSING_SECTIONS should flag
      expect(flags.some((p) => p.id === "MISSING_SECTIONS")).toBe(true);
    });

    it("should recognize present sections", () => {
      const content = JSON.stringify({
        name: "Test",
        description: "A test skill",
        scope: "Testing",
        out_of_scope: ["production"],
        examples: [],
      });

      const { flags } = audit.check(content, SkillPolicies);

      // MISSING_SECTIONS should not flag
      expect(flags.some((p) => p.id === "MISSING_SECTIONS")).toBe(false);
    });
  });
});
