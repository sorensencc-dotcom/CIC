// Run command: execute CIC pipeline with Humanizer support

import { Command } from "commander";
import { TextSegment, PostProcessorConfig } from "../../interfaces/postprocessor";
import { HumanizerPostProcessor } from "../../postprocessors/humanizer";
import { PipelineFactory } from "../../pipeline";
import { HarvesterStage } from "../../stages/harvester";
import { AuditorStage } from "../../stages/auditor";

/**
 * Create the 'cic run' command.
 * Usage: cic run [--humanize] [--humanize-profile <profile>] [--diff]
 */
export function createRunCommand(): Command {
  const command = new Command()
    .name("run")
    .description("Execute CIC processing pipeline with optional Humanizer")
    .option(
      "--humanize",
      "Enable Humanizer PostProcessor stage (AI fingerprint removal)",
      false
    )
    .option(
      "--humanize-profile <profile>",
      "Humanizer profile (default|rewrite-labs|custom)",
      "default"
    )
    .option(
      "--humanize-tiers <tiers>",
      "Rule tiers for custom profile (comma-separated: 1,2,3)",
      ""
    )
    .option(
      "--diff",
      "Show before/after diffs for humanized segments (implies --humanize)",
      false
    )
    .option(
      "--dry-run",
      "Run pipeline without modifying data",
      false
    )
    .action(async (options: Record<string, unknown>) => {
      try {
        // Parse options
        const humanizeEnabled = (options.humanize as boolean) || (options.diff as boolean);
        const profile = (options.humanizeProfile as string) || "default";
        const isDiff = options.diff as boolean;
        const isDryRun = options.dryRun as boolean;

        // Parse custom tiers if specified
        const ruleTiers: Record<string, boolean> = {};
        if (profile === "custom" && options.humanizeTiers) {
          const tiers = (options.humanizeTiers as string).split(",");
          if (tiers.includes("1")) ruleTiers["tier1"] = true;
          if (tiers.includes("2")) ruleTiers["tier2"] = true;
          if (tiers.includes("3")) ruleTiers["tier3"] = true;
        }

        console.log("[CIC] Starting pipeline execution");
        console.log(`[CIC] Humanizer enabled: ${humanizeEnabled}`);
        if (humanizeEnabled) {
          console.log(`[CIC] Profile: ${profile}`);
          console.log(`[CIC] Diff mode: ${isDiff}`);
        }

        // Create PostProcessor configuration
        const postProcessorConfig: PostProcessorConfig = {
          enabled: humanizeEnabled,
          profile: profile as "default" | "rewrite-labs" | "custom",
          ruleTiers: Object.keys(ruleTiers).length > 0 ? ruleTiers : undefined,
          dryRun: isDiff || isDryRun,
        };

        // Create PostProcessor instance
        const postProcessor = new HumanizerPostProcessor(postProcessorConfig);
        if (postProcessor.initialize) {
          await postProcessor.initialize();
        }

        // Create pipeline stages
        const stages = new Map();
        stages.set("Harvester", new HarvesterStage());

        if (humanizeEnabled) {
          const postProcessorStage = PipelineFactory.wrapPostProcessor(postProcessor);
          stages.set("PostProcessor", postProcessorStage);
        }

        stages.set("Auditor", new AuditorStage());

        // Create pipeline
        const pipelineConfig = { postProcessor: postProcessorConfig };
        const pipeline = PipelineFactory.createPipeline(pipelineConfig, stages);

        // For testing, create sample segments
        const sampleSegments: TextSegment[] = [
          {
            id: "sample-1",
            source: "test",
            content:
              "The term is primarily promoted by Dutch institutions—not by people themselves. This enduring testament to the broader trend highlights its significance.",
          },
          {
            id: "sample-2",
            source: "test",
            content:
              "Additionally, this groundbreaking approach serves as a pivotal moment in the evolution of modern systems, underscoring the importance of strategic alignment.",
          },
        ];

        // Execute pipeline
        const results = await pipeline.execute(sampleSegments);

        // Display results
        console.log(`\n[CIC] Pipeline execution complete\n`);
        for (const segment of results) {
          console.log(`Segment: ${segment.id}`);
          if (isDiff && segment.humanized && segment.humanized.edits.length > 0) {
            console.log("  Changes:");
            for (const edit of segment.humanized.edits.slice(0, 3)) {
              console.log(`    - [${edit.ruleName}]`);
              console.log(`      Before: "${edit.before}"`);
              console.log(`      After:  "${edit.after}"`);
            }
            if (segment.humanized.edits.length > 3) {
              console.log(`    ... and ${segment.humanized.edits.length - 3} more`);
            }
          } else if (humanizeEnabled && !isDiff && segment.humanized) {
            console.log(`  Humanized: ${segment.humanized.applied}`);
            console.log(`  Edits: ${segment.humanized.edits.length || 0}`);
          }
        }

        console.log("\n[CIC] Success");
        process.exit(0);
      } catch (error) {
        console.error("[CIC] Pipeline error:", error);
        process.exit(1);
      }
    });

  return command;
}
