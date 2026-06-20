// SCP Skill Diff Command - Phase 28a.3
// CLI interface for change detection: /skill-manifest diff <skill-id>

import { Command } from "commander";
import { ChangeDetectionService } from "../../governance/services/change-detection-service";
import { Database } from "../../governance/db";

interface DiffCommandOptions {
  summary?: boolean;
  showPatch?: boolean;
}

export function createDiffCommand(
  db: Database
): Command {
  const changeDetection = new ChangeDetectionService(db);

  const command = new Command("diff")
    .description("Detect local changes vs upstream HEAD")
    .argument("<skill-id>", "Skill identifier")
    .option("--summary", "Show only line counts (default)")
    .option("--show-patch", "Show unified diff output")
    .action(
      async (skillId: string, options: DiffCommandOptions) => {
        try {
          // Validate skill-id format
          if (!isValidSkillId(skillId)) {
            console.error(
              "❌ Invalid skill-id. Use lowercase letters, numbers, dash, underscore only."
            );
            process.exit(1);
          }

          console.log(`📊 Detecting changes for: ${skillId}`);
          const result = await changeDetection.detectChanges(skillId);

          // Handle error statuses
          if (result.summary.status === "not-found") {
            console.error(
              `❌ Skill not found in manifest. Register with: /skill-manifest register <url> ${skillId}`
            );
            process.exit(1);
          }

          if (result.summary.status === "network-fail") {
            console.warn(
              "⚠️  Could not reach upstream after retries. Showing cached state."
            );
            console.warn(`   Error: ${result.summary.errorMessage}`);
          }

          if (result.summary.status === "error") {
            console.error(`❌ Detection error: ${result.summary.errorMessage}`);
            process.exit(1);
          }

          // Display results
          displayDiffResult(result, options);
          process.exit(0);
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          console.error(`❌ Command error: ${msg}`);
          process.exit(1);
        }
      }
    );

  return command;
}

function isValidSkillId(id: string): boolean {
  return /^[a-z0-9\-_]+$/.test(id);
}

function displayDiffResult(
  result: any,
  options: DiffCommandOptions
): void {
  const { summary, skillName } = result;

  if (summary.status === "no-change") {
    console.log(`✅ ${skillName}`);
    console.log("   No changes detected. Local matches upstream.");
    return;
  }

  if (summary.status === "modified") {
    console.log(`📝 ${skillName}`);
    console.log(
      `   ${summary.linesAdded} added, ${summary.linesDeleted} deleted, ${summary.linesModified} modified`
    );
    console.log(`   Change: ${summary.percentageChanged}% of content`);
    console.log(`   Last detected: ${summary.lastDetectedAt}`);

    if (options.showPatch && result.unifiedDiff) {
      console.log("\n" + "=".repeat(60));
      console.log(result.unifiedDiff);
      console.log("=".repeat(60) + "\n");
    }

    return;
  }

  // Other statuses (error, network-fail) already handled above
  console.log(
    `⚠️  Detection status: ${summary.status} — ${summary.errorMessage}`
  );
}
