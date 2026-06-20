// SCP Skill Status Command - Phase 28a.5
// /skill-manifest status <skill-id> [--all]

import { Command } from "commander";
import { StatusTracker } from "../../governance/services/status-tracker";
import { ManifestService } from "../../governance/services/manifest-service";
import { Database } from "../../governance/db";

export function createStatusCommand(
  manifestService: ManifestService,
  db?: Database
): Command {
  if (!db) {
    return new Command("status")
      .description("Check PR status for skill")
      .argument("<skill-id>")
      .action(() => {
        console.error(
          "❌ Database not initialized. Cannot check status."
        );
        throw new Error("DB required for status command");
      });
  }

  const tracker = new StatusTracker(db);

  return new Command("status")
    .description("Check PR status for skill")
    .argument("<skill-id>", "Skill identifier")
    .option("--all", "Check all PRs (open + closed)")
    .action(async (skillId, options) => {
      try {
        // Validate skill-id
        if (!/^[a-z0-9\-_]+$/.test(skillId)) {
          throw new Error(
            "Invalid skill-id. Use lowercase letters, numbers, dash, underscore only."
          );
        }

        console.log(`📊 Checking PR status for: ${skillId}`);

        // Fetch skill manifest
        const skill = await manifestService.getSkillById(skillId);
        if (!skill) {
          throw new Error(
            `Skill not found: ${skillId}. Register with: /skill-manifest register <url> ${skillId}`
          );
        }

        console.log(`   Skill: ${skill.skill_name}`);
        console.log(`   Repo: ${skill.source_repo_url}\n`);

        // Check all PRs
        const statuses = await tracker.checkAllPRsForSkill(skillId);

        if (statuses.length === 0) {
          console.log("   ℹ️  No PRs found.\n");
          return;
        }

        // Display results
        console.log(`   PR Status Summary (${statuses.length} PRs)\n`);
        console.log(
          "   PR #  | Status     | Review              | Comments | Commit"
        );
        console.log("   ------|------------|---------------------|----------|--------");

        for (const status of statuses) {
          const prStr = `#${status.prNumber}`.padEnd(5);
          const statusStr = status.status.padEnd(10);
          const reviewStr = status.reviewState.padEnd(19);
          const commentsStr = String(status.reviewComments).padEnd(8);
          const commitStr = status.commitStatus || "pending";

          console.log(
            `   ${prStr} | ${statusStr} | ${reviewStr} | ${commentsStr} | ${commitStr}`
          );
        }

        console.log("\n");

        // Summary stats
        const merged = statuses.filter((s) => s.status === "merged").length;
        const open = statuses.filter((s) => s.status === "open").length;
        const closed = statuses.filter((s) => s.status === "closed").length;

        console.log(`   📈 Summary:`);
        console.log(`      Open: ${open}  Merged: ${merged}  Closed: ${closed}\n`);

        // Review state summary
        const approved = statuses.filter(
          (s) => s.reviewState === "approved"
        ).length;
        const changesRequested = statuses.filter(
          (s) => s.reviewState === "changes-requested"
        ).length;

        if (approved > 0 || changesRequested > 0) {
          console.log(`   🔍 Review State:`);
          if (approved > 0) console.log(`      ✓ Approved: ${approved}`);
          if (changesRequested > 0)
            console.log(`      ⚠️  Changes Requested: ${changesRequested}`);
          console.log();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error: ${msg}`);
        throw error;
      }
    });
}
