import { HumanizerPostProcessor } from "../humanizer";
import { PostProcessorConfig, TextSegment } from "../../../interfaces/postprocessor";

describe("Humanizer Determinism Verification", () => {
  describe("isDeterministic() method", () => {
    test("verifies determinism with default test segment", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const isDeterministic = processor.isDeterministic(10);
      expect(isDeterministic).toBe(true);
    });

    test("verifies determinism across 50 iterations", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const isDeterministic = processor.isDeterministic(50);
      expect(isDeterministic).toBe(true);
    });

    test("handles custom iterations parameter", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(5)).toBe(true);
      expect(processor.isDeterministic(100)).toBe(true);
    });
  });

  describe("Process idempotence across multiple executions", () => {
    test("produces identical output for same input (Tier 1)", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segment: TextSegment = {
        id: "test-1",
        source: "test",
        content: "The approach—primarily promoted by institutions. This IMPORTANT concept matters.",
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);
      const result3 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result2.finalContent).toBe(result3.finalContent);

      expect(result1.edits.length).toBe(result2.edits.length);
      expect(result2.edits.length).toBe(result3.edits.length);
    });

    test("produces identical output for same input (Tier 1+2)", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segment: TextSegment = {
        id: "test-2",
        source: "test",
        content:
          "In order to succeed, the approach—primary promoted—serves as a model. Additionally, this enduring testament works.",
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);
      const result3 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });

    test("produces identical edit records", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segment: TextSegment = {
        id: "test-3",
        source: "test",
        content: "The pattern—important for growth—highlights significance",
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);

      expect(result1.edits.length).toBe(result2.edits.length);

      result1.edits.forEach((edit, idx) => {
        const edit2 = result2.edits[idx];
        expect(edit.ruleId).toBe(edit2.ruleId);
        expect(edit.ruleName).toBe(edit2.ruleName);
        expect(edit.before).toBe(edit2.before);
        expect(edit.after).toBe(edit2.after);
        expect(edit.confidence).toBe(edit2.confidence);
        expect(edit.lineNum).toBe(edit2.lineNum);
      });
    });
  });

  describe("Batch processing determinism", () => {
    test("processBatch produces deterministic results", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segments: TextSegment[] = [
        {
          id: "batch-1",
          source: "test",
          content: "First segment—with dashes",
        },
        {
          id: "batch-2",
          source: "test",
          content: "Second segment additionally works",
        },
      ];

      const result1 = processor.processBatch(segments);
      const result2 = processor.processBatch(segments);

      result1.forEach((r1, idx) => {
        const r2 = result2[idx];
        expect(r1.finalContent).toBe(r2.finalContent);
        expect(r1.edits.length).toBe(r2.edits.length);
      });
    });
  });

  describe("Determinism with different profiles", () => {
    test("default profile is deterministic", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(20)).toBe(true);
    });

    test("rewrite-labs profile is deterministic", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(20)).toBe(true);
    });

    test("custom profile is deterministic", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "custom",
        ruleTiers: { tier1: true, tier2: false },
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(20)).toBe(true);
    });
  });

  describe("Determinism with different confidence thresholds", () => {
    test("high confidence threshold is deterministic", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
        confidenceThresholds: {
          apply: 0.95,
        },
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(20)).toBe(true);
    });

    test("low confidence threshold is deterministic", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
        confidenceThresholds: {
          apply: 0.70,
        },
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      expect(processor.isDeterministic(20)).toBe(true);
    });
  });

  describe("Determinism preservation across initialization", () => {
    test("multiple initializations preserve determinism", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor1 = new HumanizerPostProcessor(config);
      await processor1.initialize();

      const processor2 = new HumanizerPostProcessor(config);
      await processor2.initialize();

      const segment: TextSegment = {
        id: "test",
        source: "test",
        content: "The approach—primary promoted—serves as a model",
      };

      const result1 = processor1.process(segment);
      const result2 = processor2.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });
  });

  describe("Edge cases for determinism", () => {
    test("handles empty string deterministically", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segment: TextSegment = {
        id: "empty",
        source: "test",
        content: "",
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });

    test("handles very long content deterministically", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const longContent = "The approach—primary promoted. " + "Additional text. ".repeat(100);

      const segment: TextSegment = {
        id: "long",
        source: "test",
        content: longContent,
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });

    test("handles special characters deterministically", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const segment: TextSegment = {
        id: "special",
        source: "test",
        content: "Content with émojis 📌 and spëcial çharacters—like dashes",
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });

    test("handles unicode deterministically", async () => {
      const config: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const processor = new HumanizerPostProcessor(config);
      await processor.initialize();

      const leftCurly = String.fromCharCode(0x201c);
      const rightCurly = String.fromCharCode(0x201d);

      const segment: TextSegment = {
        id: "unicode",
        source: "test",
        content: `Text with ${leftCurly}curly quotes${rightCurly}—and dashes`,
      };

      const result1 = processor.process(segment);
      const result2 = processor.process(segment);

      expect(result1.finalContent).toBe(result2.finalContent);
      expect(result1.edits.length).toBe(result2.edits.length);
    });
  });
});
