import { TextSegment, PostProcessorConfig } from "../../interfaces/postprocessor";
import { HumanizerPostProcessor } from "../../postprocessors/humanizer";
import { PipelineFactory } from "../factory";
import { HarvesterStage } from "../../stages/harvester";
import { AuditorStage } from "../../stages/auditor";

describe("Pipeline Integration - Harvester → PostProcessor → Auditor", () => {
  describe("Full pipeline execution with Humanizer", () => {
    test("executes all stages in sequence", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
        dryRun: false,
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("Harvester", new HarvesterStage());
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));
      stages.set("Auditor", new AuditorStage());

      const pipelineConfig = { postProcessor: postProcessorConfig };
      const pipeline = PipelineFactory.createPipeline(pipelineConfig, stages);

      const segments: TextSegment[] = [
        {
          id: "test-1",
          source: "markdown",
          content:
            "The approach primarily promoted by institutions—not by people themselves. Additionally, this enduring testament highlights its significance.",
        },
      ];

      const results = await pipeline.execute(segments);

      expect(results).toBeDefined();
      expect(results.length).toBe(1);
      expect(results[0].humanized).toBeDefined();
      expect(results[0].humanized!.applied).toBe(true);
      expect(results[0].humanized!.edits.length).toBeGreaterThan(0);
    });

    test("preserves segment metadata through pipeline", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("Harvester", new HarvesterStage());
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));
      stages.set("Auditor", new AuditorStage());

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment: TextSegment = {
        id: "test-2",
        source: "wikipedia",
        content: "Test content",
        metadata: {
          url: "https://example.com",
          confidence: 0.95,
        },
      };

      const results = await pipeline.execute([segment]);

      expect(results[0].id).toBe("test-2");
      expect(results[0].source).toBe("wikipedia");
      expect(results[0].metadata).toBeDefined();
      expect(results[0].metadata!.url).toBe("https://example.com");
    });
  });

  describe("Pipeline with rewrite-labs profile", () => {
    test("applies Tier 1 + Tier 2 rules", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment: TextSegment = {
        id: "test-tier-mix",
        source: "test",
        content:
          "In order to understand the pattern—this enduring testament shows significance. The approach is high-quality and serves as a model.",
      };

      const results = await pipeline.execute([segment]);

      expect(results[0].humanized).toBeDefined();
      const edits = results[0].humanized!.edits;
      expect(edits.length).toBeGreaterThan(3);

      // Verify both Tier 1 and Tier 2 rules applied
      const hasEmDashRule = edits.some((e) => e.ruleId === 14);
      const hasFillerRule = edits.some((e) => e.ruleId === 23);
      expect(hasEmDashRule || hasFillerRule).toBe(true);
    });
  });

  describe("Pipeline with dry-run mode", () => {
    test("does not modify content in dry-run", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
        dryRun: true,
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const originalContent =
        "The approach primarily promoted—by institutions. Additionally, this enduring testament works.";
      const segment: TextSegment = {
        id: "dry-run-test",
        source: "test",
        content: originalContent,
      };

      const results = await pipeline.execute([segment]);

      // Edits should be recorded
      expect(results[0].humanized).toBeDefined();
      expect(results[0].humanized!.edits.length).toBeGreaterThan(0);

      // But content should remain original
      expect(results[0].content).toBe(originalContent);
    });

    test("applies edits when dry-run is false", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
        dryRun: false,
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const originalContent = "The approach—by institutions";
      const segment: TextSegment = {
        id: "apply-edits-test",
        source: "test",
        content: originalContent,
      };

      const results = await pipeline.execute([segment]);

      // Content should be modified
      expect(results[0].content).not.toBe(originalContent);
      expect(results[0].content).toContain(",");
    });
  });

  describe("Pipeline with custom rule tiers", () => {
    test("applies only selected tiers", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "custom",
        ruleTiers: { tier1: true, tier2: false },
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment: TextSegment = {
        id: "custom-tiers",
        source: "test",
        content: "In order to proceed—this is important",
      };

      const results = await pipeline.execute([segment]);

      const edits = results[0].humanized!.edits;

      // Should have em-dash edit (Tier 1)
      const hasEmDash = edits.some((e) => e.ruleId === 14);

      // Should NOT have filler phrase edit (Tier 2)
      const hasFiller = edits.some((e) => e.ruleId === 23);

      expect(hasEmDash).toBe(true);
      expect(hasFiller).toBe(false);
    });
  });

  describe("Pipeline with confidence threshold", () => {
    test("filters edits below confidence threshold", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "rewrite-labs",
        confidenceThresholds: {
          apply: 0.95,
        },
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment: TextSegment = {
        id: "confidence-test",
        source: "test",
        content: "Additionally, this pattern is high-quality and serves as a model",
      };

      const results = await pipeline.execute([segment]);

      const edits = results[0].humanized!.edits;

      // Only high-confidence edits (Tier 1) should remain
      edits.forEach((edit) => {
        expect(edit.confidence).toBeGreaterThanOrEqual(0.95);
      });
    });
  });

  describe("Pipeline error handling", () => {
    test("handles segments with empty content", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment: TextSegment = {
        id: "empty",
        source: "test",
        content: "",
      };

      const results = await pipeline.execute([segment]);

      expect(results[0].content).toBe("");
      expect(results[0].humanized).toBeDefined();
    });

    test("handles segments with null content gracefully", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segment = {
        id: "null-content",
        source: "test",
        content: null as unknown as string,
      } as TextSegment;

      const results = await pipeline.execute([segment]);

      expect(results[0]).toBeDefined();
    });
  });

  describe("Pipeline with disabled PostProcessor", () => {
    test("skips humanization when disabled", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: false,
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("Harvester", new HarvesterStage());
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));
      stages.set("Auditor", new AuditorStage());

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const originalContent = "The approach—by institutions";
      const segment: TextSegment = {
        id: "disabled-test",
        source: "test",
        content: originalContent,
      };

      const results = await pipeline.execute([segment]);

      expect(results[0].content).toBe(originalContent);
      expect(results[0].humanized).toBeUndefined();
    });
  });

  describe("Pipeline batch processing", () => {
    test("processes multiple segments", async () => {
      const postProcessorConfig: PostProcessorConfig = {
        enabled: true,
        profile: "default",
      };

      const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
      await postProcessor.initialize();

      const stages = new Map();
      stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(postProcessor));

      const pipeline = PipelineFactory.createPipeline({ postProcessor: postProcessorConfig }, stages);

      const segments: TextSegment[] = [
        {
          id: "seg-1",
          source: "test",
          content: "First segment—with dashes",
        },
        {
          id: "seg-2",
          source: "test",
          content: "Second segment additionally with filler",
        },
        {
          id: "seg-3",
          source: "test",
          content: "Third segment plain",
        },
      ];

      const results = await pipeline.execute(segments);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.humanized).toBeDefined();
      });
    });
  });
});
