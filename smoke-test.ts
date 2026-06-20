#!/usr/bin/env node

/**
 * Smoke Test: End-to-end validation of Humanizer integration
 * Validates: CLI, pipeline, rules, determinism, audit trail
 */

import { HumanizerPostProcessor } from "./src/postprocessors/humanizer/index";
import { TextSegment, PostProcessorConfig } from "./src/interfaces/postprocessor";
import { PipelineFactory } from "./src/pipeline/factory";
import { HarvesterStage } from "./src/stages/harvester";
import { AuditorStage } from "./src/stages/auditor";

async function runSmokeTest() {
  console.log("[SMOKE TEST] Starting Humanizer validation...\n");

  let passed = 0;
  let failed = 0;

  // Test 1: PostProcessor instantiation
  try {
    console.log("[TEST 1] PostProcessor instantiation");
    const config: PostProcessorConfig = { enabled: true, profile: "rewrite-labs" };
    const processor = new HumanizerPostProcessor(config);
    await processor.initialize();
    console.log("✓ PASS: PostProcessor created and initialized\n");
    passed++;
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 2: Determinism check
  try {
    console.log("[TEST 2] Determinism guarantee");
    const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
    const isDet = processor.isDeterministic(10);
    if (isDet) {
      console.log("✓ PASS: Determinism verified across 10 iterations\n");
      passed++;
    } else {
      console.log("✗ FAIL: Non-deterministic behavior detected\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 3: Tier 1 rules
  try {
    console.log("[TEST 3] Tier 1 rules (em-dash, quotes, case, emoji, bold)");
    const processor = new HumanizerPostProcessor({ enabled: true, profile: "default" });
    await processor.initialize();

    const segment: TextSegment = {
      id: "test-tier1",
      source: "test",
      content: "The approach—primary promoted. **IMPORTANT** concept.",
    };

    const result = processor.process(segment);

    if (result.applied && result.edits.length > 0) {
      console.log(`✓ PASS: ${result.edits.length} Tier 1 edits applied`);
      result.edits.forEach((e) => console.log(`  - ${e.ruleName}: "${e.before}" → "${e.after}"`));
      console.log();
      passed++;
    } else {
      console.log("✗ FAIL: No Tier 1 edits applied\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 4: Tier 2 rules
  try {
    console.log("[TEST 4] Tier 2 rules (filler, copula, vocabulary)");
    const processor = new HumanizerPostProcessor({ enabled: true, profile: "rewrite-labs" });
    await processor.initialize();

    const segment: TextSegment = {
      id: "test-tier2",
      source: "test",
      content: "In order to succeed, this serves as a model. Additionally, it offers great value.",
    };

    const result = processor.process(segment);

    if (result.edits.length > 0) {
      const tier2Edits = result.edits.filter((e) => e.ruleId && [23, 8, 7].includes(e.ruleId));
      if (tier2Edits.length > 0) {
        console.log(`✓ PASS: ${tier2Edits.length} Tier 2 edits applied`);
        tier2Edits.forEach((e) => console.log(`  - ${e.ruleName}: "${e.before}" → "${e.after}"`));
        console.log();
        passed++;
      } else {
        console.log("✗ FAIL: No Tier 2 edits applied\n");
        failed++;
      }
    } else {
      console.log("✗ FAIL: No edits applied\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 5: Pipeline integration
  try {
    console.log("[TEST 5] Pipeline integration");
    const config: PostProcessorConfig = { enabled: true, profile: "default" };
    const processor = new HumanizerPostProcessor(config);
    await processor.initialize();

    const stages = new Map();
    stages.set("Harvester", new HarvesterStage());
    stages.set("PostProcessor", PipelineFactory.wrapPostProcessor(processor));
    stages.set("Auditor", new AuditorStage());

    const pipeline = PipelineFactory.createPipeline({ postProcessor: config }, stages);

    const segments: TextSegment[] = [
      {
        id: "pipe-1",
        source: "test",
        content: "The pattern—important—works well",
      },
    ];

    const results = await pipeline.execute(segments);

    if (results[0].humanized && results[0].humanized.edits.length > 0) {
      console.log(`✓ PASS: Pipeline executed, ${results[0].humanized.edits.length} edits applied\n`);
      passed++;
    } else {
      console.log("✗ FAIL: Pipeline didn't apply edits\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 6: Disabled processor
  try {
    console.log("[TEST 6] Disabled processor");
    const config: PostProcessorConfig = { enabled: false };
    const processor = new HumanizerPostProcessor(config);
    await processor.initialize();

    const segment: TextSegment = {
      id: "disabled",
      source: "test",
      content: "The approach—works well",
    };

    const result = processor.process(segment);

    if (!result.applied && result.edits.length === 0) {
      console.log("✓ PASS: Disabled processor returned no edits\n");
      passed++;
    } else {
      console.log("✗ FAIL: Disabled processor applied edits\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 7: Dry-run mode
  try {
    console.log("[TEST 7] Dry-run mode");
    const config: PostProcessorConfig = { enabled: true, profile: "default", dryRun: true };
    const processor = new HumanizerPostProcessor(config);
    await processor.initialize();

    const originalContent = "The approach—works";
    const segment: TextSegment = {
      id: "dryrun",
      source: "test",
      content: originalContent,
    };

    const result = processor.process(segment);

    if (result.edits.length > 0 && result.finalContent === originalContent) {
      console.log("✓ PASS: Dry-run recorded edits without modifying content\n");
      passed++;
    } else {
      console.log("✗ FAIL: Dry-run behavior incorrect\n");
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Test 8: Confidence threshold filtering
  try {
    console.log("[TEST 8] Confidence threshold filtering");
    const config: PostProcessorConfig = {
      enabled: true,
      profile: "rewrite-labs",
      confidenceThresholds: { apply: 0.95 },
    };
    const processor = new HumanizerPostProcessor(config);
    await processor.initialize();

    const segment: TextSegment = {
      id: "threshold",
      source: "test",
      content: "In order to proceed, this serves as a key approach.",
    };

    const result = processor.process(segment);

    const lowConfEdits = result.edits.filter((e) => e.confidence < 0.95);
    if (lowConfEdits.length === 0) {
      console.log(`✓ PASS: Only edits ≥0.95 confidence applied (${result.edits.length} total)\n`);
      passed++;
    } else {
      console.log(
        `✗ FAIL: Low confidence edits present (${lowConfEdits.length} edits < 0.95)\n`
      );
      failed++;
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e}\n`);
    failed++;
  }

  // Summary
  console.log("=".repeat(60));
  console.log(`[SMOKE TEST SUMMARY] ${passed} PASS, ${failed} FAIL\n`);

  if (failed === 0) {
    console.log("✓ All smoke tests passed! Humanizer integration is ready for deployment.\n");
    process.exit(0);
  } else {
    console.log(`✗ ${failed} test(s) failed. Fix before deploying.\n`);
    process.exit(1);
  }
}

runSmokeTest().catch((e) => {
  console.error("[SMOKE TEST] Fatal error:", e);
  process.exit(1);
});
