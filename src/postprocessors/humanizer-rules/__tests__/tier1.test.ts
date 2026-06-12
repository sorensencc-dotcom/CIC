import { TIER1_RULES } from "../tier1";
import { TextSegment } from "../../../interfaces/postprocessor";

describe("Tier 1 Rules - Mechanical Transformations", () => {
  describe("rule14_EmDashes", () => {
    const rule = TIER1_RULES.find((r) => r.id === 14)!;

    test("converts em-dashes to comma", () => {
      const text = "The trend highlights its significance—not by choice.";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
      expect(result.text).toBe("The trend highlights its significance, not by choice.");
    });

    test("converts en-dashes to comma", () => {
      const text = "This is a range–2024.";
      const result = rule.apply(text);
      expect(result.text).toContain(",");
    });

    test("converts double hyphens to comma", () => {
      const text = "The approach -- strategic -- works.";
      const result = rule.apply(text);
      expect(result.edits.length).toBeGreaterThan(0);
    });

    test("confidence is 1.0", () => {
      const text = "Test—case";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(1.0);
      }
    });

    test("idempotent", () => {
      const text = "The trend highlights its significance—not by choice.";
      const result1 = rule.apply(text);
      const result2 = rule.apply(result1.text);
      expect(result2.edits.length).toBe(0);
    });
  });

  describe("rule19_CurlyQuotes", () => {
    const rule = TIER1_RULES.find((r) => r.id === 19)!;

    test("handles double curly quotes", () => {
      // Using String.fromCharCode for curly quotes to avoid encoding issues
      const leftCurly = String.fromCharCode(0x201c);
      const rightCurly = String.fromCharCode(0x201d);
      const text = `He said ${leftCurly}hello${rightCurly}`;
      const result = rule.apply(text);
      expect(result.text).not.toContain(leftCurly);
      expect(result.text).not.toContain(rightCurly);
    });

    test("handles single curly quotes", () => {
      const leftCurly = String.fromCharCode(0x2018);
      const rightCurly = String.fromCharCode(0x2019);
      const text = `He said ${leftCurly}hello${rightCurly}`;
      const result = rule.apply(text);
      expect(result.text).not.toContain(leftCurly);
      expect(result.text).not.toContain(rightCurly);
    });

    test("confidence is 1.0", () => {
      const leftCurly = String.fromCharCode(0x201c);
      const rightCurly = String.fromCharCode(0x201d);
      const text = `"${leftCurly}test${rightCurly}"`;
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(1.0);
      }
    });

    test("idempotent", () => {
      const leftCurly = String.fromCharCode(0x201c);
      const rightCurly = String.fromCharCode(0x201d);
      const text = `He said ${leftCurly}hello${rightCurly}`;
      const result1 = rule.apply(text);
      const result2 = rule.apply(result1.text);
      expect(result2.edits.length).toBe(0);
    });
  });

  describe("rule17_TitleCase", () => {
    const rule = TIER1_RULES.find((r) => r.id === 17)!;

    test("converts all-caps initial word to sentence case", () => {
      const text = "INTRODUCTION To Data Science\nIntroduction to physics";
      const result = rule.apply(text);
      expect(result.text).toContain("Introduction To Data Science");
    });

    test("only converts at start of line", () => {
      const text = "Some text IMPORTANT here";
      const result = rule.apply(text);
      expect(result.edits.length).toBe(0);
    });

    test("confidence is 1.0", () => {
      const text = "OVERVIEW";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(1.0);
      }
    });
  });

  describe("rule18_Emojis", () => {
    const rule = TIER1_RULES.find((r) => r.id === 18)!;

    test("removes emoji decorations from headings", () => {
      const text = "📌 Important Section\n✓ Item 1";
      const result = rule.apply(text);
      expect(result.text).not.toContain("📌");
      expect(result.text).not.toContain("✓");
    });

    test("leaves emoji in paragraph text", () => {
      const text = "This is great 👍 idea";
      const result = rule.apply(text);
      // Should not remove emoji in middle of content
      expect(result.edits.length).toBe(0);
    });
  });

  describe("rule15_Boldface", () => {
    const rule = TIER1_RULES.find((r) => r.id === 15)!;

    test("removes boldface from short phrases", () => {
      const text = "This is **very important** concept";
      const result = rule.apply(text);
      expect(result.text).toContain("very important");
      expect(result.text).not.toContain("**");
    });

    test("removes boldface from acronyms", () => {
      const text = "Use **API** for integration";
      const result = rule.apply(text);
      expect(result.text).not.toContain("**");
    });

    test("keeps boldface on longer phrases", () => {
      const text = "**This is a long important concept**";
      const result = rule.apply(text);
      // Should keep bolding on >3 word phrases
      expect(result.edits.length).toBe(0);
    });

    test("confidence is 0.95", () => {
      const text = "The **term** is important";
      const result = rule.apply(text);
      if (result.edits.length > 0) {
        expect(result.edits[0].confidence).toBe(0.95);
      }
    });
  });

  describe("Tier1 rule coverage", () => {
    test("all tier1 rules have confidence >= 0.95", () => {
      TIER1_RULES.forEach((rule) => {
        const testText = "Sample text for testing rule confidence";
        const result = rule.apply(testText);
        result.edits.forEach((edit) => {
          expect(edit.confidence).toBeGreaterThanOrEqual(0.95);
        });
      });
    });

    test("all tier1 rules have tier=1", () => {
      TIER1_RULES.forEach((rule) => {
        expect(rule.tier).toBe(1);
      });
    });

    test("all tier1 rules are in expected categories", () => {
      const validCategories = ["content", "language", "style", "communication", "filler"];
      TIER1_RULES.forEach((rule) => {
        expect(validCategories).toContain(rule.category);
      });
    });
  });
});
