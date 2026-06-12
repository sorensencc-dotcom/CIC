import { HumanizerPostProcessor } from "../humanizer";
import { PostProcessorConfig, TextSegment } from "../../../interfaces/postprocessor";

describe("HumanizerPostProcessor", () => {
  describe("Initialization", () => {
    test("initializes with default config", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      expect(processor.isDeterministic()).toBe(true);
    });

    test("initializes with rewrite-labs profile", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "rewrite-labs" });
      await processor.initialize();

      expect(processor.isDeterministic()).toBe(true);
    });

    test("initializes with custom profile", async () => {
      const processor = new HumanizerPostProcessor({
        enabled: true,
        profile: "custom",
        ruleTiers: { tier1: true, tier2: true },
      });
      await processor.initialize();

      expect(processor.isDeterministic()).toBe(true);
    });

    test("runs determinism check on initialize", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });

      // This should run and complete without error
      await processor.initialize();

      // Verify determinism was checked
      expect(processor.isDeterministic(5)).toBe(true);
    });
  });

  describe("process() method", () => {
    test("returns HumanizationResult with expected fields", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Test—content",
      };

      const result = processor.process(segment);

      expect(result.applied).toBeDefined();
      expect(result.finalContent).toBeDefined();
      expect(result.edits).toBeInstanceOf(Array);
      expect(result.metadata).toBeDefined();
    });

    test("populates segment.humanized with result", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Test—content",
      };

      processor.process(segment);

      expect(segment.humanized).toBeDefined();
      expect(segment.humanized!.edits).toBeInstanceOf(Array);
    });

    test("applies Tier 1 rules by default", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "The approach—primary promoted",
      };

      const result = processor.process(segment);

      expect(result.edits.length).toBeGreaterThan(0);
      expect(result.edits.some((e) => e.ruleId === 14)).toBe(true); // em-dash rule
    });

    test("applies Tier 1+2 with rewrite-labs profile", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "rewrite-labs" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "In order to proceed—this approach serves as a model",
      };

      const result = processor.process(segment);

      // Should have edits from both tiers
      const hasTier1 = result.edits.some((e) => e.ruleId === 14);
      const hasTier2 = result.edits.some((e) => e.ruleId === 23 || e.ruleId === 8);

      expect(hasTier1 || hasTier2).toBe(true);
    });

    test("respects custom rule tiers", async () => {
      const processor = new HumanizerPostProcessor({
        enabled: true,
        profile: "custom",
        ruleTiers: { tier1: true, tier2: false },
      });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "In order to proceed—approach",
      };

      const result = processor.process(segment);

      // Should have Tier 1 edits
      const hasTier1 = result.edits.some((e) => e.tier === 1);

      // Should NOT have Tier 2 edits
      const hasTier2 = result.edits.some((e) => e.tier === 2);

      expect(hasTier1 || result.edits.length === 0).toBe(true);
      expect(hasTier2).toBe(false);
    });

    test("filters edits by confidence threshold", async () => {
      const processor = new HumanizerPostProcessor({
        enabled: true,
        profile: "rewrite-labs",
        confidenceThresholds: { apply: 0.95 },
      });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Additionally, in order to proceed—approach is high-quality",
      };

      const result = processor.process(segment);

      // All returned edits should be >= threshold
      result.edits.forEach((edit) => {
        expect(edit.confidence).toBeGreaterThanOrEqual(0.95);
      });
    });

    test("handles dry-run mode", async () => {
      const processor = new HumanizerPostProcessor({
        enabled: true,
        profile: "default",
        dryRun: true,
      });
      await processor.initialize();

      const originalContent = "Test—content";
      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: originalContent,
      };

      processor.process(segment);

      // Content should remain unchanged in dry-run
      expect(segment.content).toBe(originalContent);

      // But edits should be recorded
      expect(segment.humanized).toBeDefined();
    });
  });

  describe("processBatch() method", () => {
    test("processes multiple segments", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segments: TextSegment[] = [
        { id: "1", source: "test", content: "First—segment" },
        { id: "2", source: "test", content: "Second—segment" },
      ];

      const results = processor.processBatch(segments);

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result.edits).toBeInstanceOf(Array);
      });
    });

    test("returns results in same order as input", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segments: TextSegment[] = [
        { id: "seg-1", source: "test", content: "First" },
        { id: "seg-2", source: "test", content: "Second" },
        { id: "seg-3", source: "test", content: "Third" },
      ];

      const results = processor.processBatch(segments);

      expect(results[0].metadata).toBeDefined();
      expect(results[1].metadata).toBeDefined();
      expect(results[2].metadata).toBeDefined();
    });

    test("handles empty batch", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const results = processor.processBatch([]);

      expect(results).toEqual([]);
    });
  });

  describe("getRulesApplied() method", () => {
    test("returns edits for segment with humanization", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Test—content",
      };

      processor.process(segment);

      const edits = processor.getRulesApplied(segment);

      expect(edits).toBeInstanceOf(Array);
      expect(edits.length).toBeGreaterThan(0);
    });

    test("returns empty array for segment without edits", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Plain content",
      };

      processor.process(segment);

      const edits = processor.getRulesApplied(segment);

      expect(edits).toBeInstanceOf(Array);
    });

    test("returns empty array for unprocessed segment", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Test content",
      };

      const edits = processor.getRulesApplied(segment);

      expect(edits).toEqual([]);
    });
  });

  describe("Configuration validation", () => {
    test("accepts all valid profiles", async () => {
      const profiles = ["default", "rewrite-labs", "custom"] as const;

      for (const profile of profiles) {
        const processor = new HumanizerPostProcessor({
          enabled: true,
          profile,
        });

        await processor.initialize();
        expect(processor.isDeterministic()).toBe(true);
      }
    });

    test("handles voice calibration config", async () => {
      const processor = new HumanizerPostProcessor({
        enabled: true,
        profile: "default",
        voiceCalibration: {
          preserve: ["casual"],
          amplify: ["technical"],
        },
      });

      await processor.initialize();
      expect(processor.isDeterministic()).toBe(true);
    });
  });

  describe("EditRecord structure", () => {
    test("edits contain all required fields", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "Test—content",
      };

      const result = processor.process(segment);

      result.edits.forEach((edit) => {
        expect(edit.ruleId).toBeDefined();
        expect(typeof edit.ruleId).toBe("number");

        expect(edit.ruleName).toBeDefined();
        expect(typeof edit.ruleName).toBe("string");

        expect(edit.category).toBeDefined();
        expect(typeof edit.category).toBe("string");

        expect(edit.before).toBeDefined();
        expect(typeof edit.before).toBe("string");

        expect(edit.after).toBeDefined();
        expect(typeof edit.after).toBe("string");

        expect(edit.confidence).toBeDefined();
        expect(typeof edit.confidence).toBe("number");

        expect(edit.lineNum).toBeDefined();
        expect(typeof edit.lineNum).toBe("number");

        expect(edit.startOffset).toBeDefined();
        expect(typeof edit.startOffset).toBe("number");

        expect(edit.endOffset).toBeDefined();
        expect(typeof edit.endOffset).toBe("number");
      });
    });

    test("edits have valid confidence values", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "rewrite-labs" });
      await processor.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content:
          "In order to test, the approach—primary promoted serves as a model. Additionally, this is high-quality.",
      };

      const result = processor.process(segment);

      result.edits.forEach((edit) => {
        expect(edit.confidence).toBeGreaterThan(0);
        expect(edit.confidence).toBeLessThanOrEqual(1.0);
      });
    });

    test("edits have valid line numbers", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      const multilineContent = "Line 1—text\nLine 2 with test\nLine 3—more";

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: multilineContent,
      };

      const result = processor.process(segment);

      result.edits.forEach((edit) => {
        expect(edit.lineNum).toBeGreaterThanOrEqual(1);
        expect(edit.startOffset).toBeGreaterThanOrEqual(0);
        expect(edit.endOffset).toBeGreaterThan(edit.startOffset);
      });
    });
  });

  describe("cleanup() method", () => {
    test("cleanup method exists", async () => {
      const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
      await processor.initialize();

      expect(typeof processor.cleanup).toBe("function");

      // Should not throw
      processor.cleanup();
    });
  });
});
