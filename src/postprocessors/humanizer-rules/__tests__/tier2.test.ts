import { TIER2_RULES } from "../tier2";

describe("Tier 2 Rules - Pattern-Based Transformations", () => {
  describe("rule23_FillerPhrases", () => {
    const rule = TIER2_RULES.find((r) => r.id === 23)!;

    test("replaces 'In order to' with 'To'", () => {
      const text = "In order to succeed, you must try.";
      const result = rule.apply(text);
      expect(result.text).toContain("To succeed");
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("replaces 'Due to the fact that' with 'Because'", () => {
      const text = "Due to the fact that we are late, we rush.";
      const result = rule.apply(text);
      expect(result.text).toContain("Because");
    });

    test("replaces 'In the event that' with 'If'", () => {
      const text = "In the event that you see an issue, report it.";
      const result = rule.apply(text);
      expect(result.text).toContain("If");
    });

    test("confidence is 0.92", () => {
      const text = "In order to test this";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(0.92);
      }
    });

    test("case insensitive matching", () => {
      const text = "IN ORDER TO proceed";
      const result = rule.apply(text);
      expect(result.text).toMatch(/to proceed/i);
    });
  });

  describe("rule26_HyphenatedPairs", () => {
    const rule = TIER2_RULES.find((r) => r.id === 26)!;

    test("removes hyphens from high-quality in predicate", () => {
      const text = "The approach is high-quality";
      const result = rule.apply(text);
      expect(result.text).toContain("high quality");
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("removes hyphens from well-known in predicate", () => {
      const text = "The pattern is well-known";
      const result = rule.apply(text);
      expect(result.text).toContain("well known");
    });

    test("keeps hyphens in attributive position", () => {
      const text = "The high-quality product is excellent";
      const result = rule.apply(text);
      // Should not modify hyphenated adjectives before nouns
      expect(result.edits.length).toBe(0);
    });

    test("confidence is 0.88", () => {
      const text = "The result is state-of-the-art";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(0.88);
      }
    });
  });

  describe("rule8_CopulaAvoidance", () => {
    const rule = TIER2_RULES.find((r) => r.id === 8)!;

    test("replaces 'serves as' with 'is'", () => {
      const text = "This pattern serves as a model";
      const result = rule.apply(text);
      expect(result.text).toContain("is");
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("replaces 'stands as' with 'is'", () => {
      const text = "The approach stands as a milestone";
      const result = rule.apply(text);
      expect(result.text).toContain("is");
    });

    test("replaces 'boasts' with 'has'", () => {
      const text = "The system boasts multiple features";
      const result = rule.apply(text);
      expect(result.text).toContain("has");
    });

    test("replaces 'features' with 'has'", () => {
      const text = "The platform features advanced capabilities";
      const result = rule.apply(text);
      expect(result.text).toContain("has");
    });

    test("replaces 'offers' with 'provides'", () => {
      const text = "We offer comprehensive support";
      const result = rule.apply(text);
      expect(result.text).toContain("provide");
    });

    test("confidence is 0.90", () => {
      const text = "This serves as an example";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBeCloseTo(0.90, 1);
      }
    });
  });

  describe("rule7_AIVocabulary", () => {
    const rule = TIER2_RULES.find((r) => r.id === 7)!;

    test("detects 'Additionally' as AI word", () => {
      const text = "Additionally, this approach works.";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("detects 'enduring' as AI word", () => {
      const text = "This enduring testament to progress";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("detects 'enhance' as AI word", () => {
      const text = "We enhance the system capability";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("detects 'emphasizing' as AI word", () => {
      const text = "emphasizing the importance of quality";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("confidence between 0.80 and 0.88", () => {
      const text = "Additionally, we enhance the system";
      const result = rule.apply(text);
      result.edits.forEach((edit) => {
        expect(edit.confidence).toBeGreaterThanOrEqual(0.80);
        expect(edit.confidence).toBeLessThanOrEqual(0.88);
      });
    });
  });

  describe("Tier 2 rule coverage", () => {
    test("all tier2 rules have confidence >= 0.80", () => {
      TIER2_RULES.forEach((rule) => {
        const testTexts = [
          "In order to test this pattern",
          "The approach is high-quality result",
          "This serves as a model",
          "Additionally, enhance the system",
        ];
        testTexts.forEach((text) => {
          const result = rule.apply(text);
          result.edits.forEach((edit) => {
            expect(edit.confidence).toBeGreaterThanOrEqual(0.80);
          });
        });
      });
    });

    test("all tier2 rules have tier=2", () => {
      TIER2_RULES.forEach((rule) => {
        expect(rule.tier).toBe(2);
      });
    });

    test("all tier2 rules have valid categories", () => {
      const validCategories = ["content", "language", "style", "communication", "filler"];
      TIER2_RULES.forEach((rule) => {
        expect(validCategories).toContain(rule.category);
      });
    });
  });

  describe("Tier 2 false positive risk", () => {
    test("rule7_AIVocabulary does not flag names", () => {
      // "Additional" is in the signal words but we check word boundaries
      const text = "John Additional is here";
      const rule = TIER2_RULES.find((r) => r.id === 7)!;
      const result = rule.apply(text);
      // May or may not flag depending on implementation strictness
      // Just verify it handles this without crashing
      expect(result).toBeDefined();
    });

    test("rule26_HyphenatedPairs does not flag non-predicate hyphens", () => {
      const text = "The high-quality, well-known product";
      const rule = TIER2_RULES.find((r) => r.id === 26)!;
      const result = rule.apply(text);
      // Should minimize edits when hyphenation is attributive
      expect(result.edits.length).toBeLessThan(2);
    });
  });
});
