// SCP CLI Command - Phase 28a.2 + 28a.3
// /skill-manifest register <repo-url> <skill-id> [--remote-path <path>]
// /skill-manifest diff <skill-id> [--summary|--show-patch]

import { Command } from "commander";
import { ManifestService } from "../../governance/services/manifest-service";
import { ChangeDetectionService } from "../../governance/services/change-detection-service";
import { SkillManifestEntry } from "../../governance/models";
import { Database } from "../../governance/db";
import * as path from "path";
import * as os from "os";

interface ManifestCommandOptions {
  db?: Database;
}

export function createManifestCommand(
  manifestService: ManifestService,
  options?: ManifestCommandOptions
): Command {
  const cmd = new Command("skill-manifest")
    .description("Manage adopted skills manifest");

  // Register subcommand
  cmd
    .command("register <repo-url> <skill-id>")
    .option("--remote-path <path>", "Path to skill in remote repo (e.g. skills/skill-name.md)")
    .option("--branch <branch>", "Source branch (default: main)", "main")
    .description("Register a skill from a GitHub repository")
    .action(async (repoUrl, skillId, options) => {
      try {
        // Validate inputs
        if (!repoUrl.includes("github.com")) {
          console.error("❌ Only GitHub repos supported in MVP (Phase 28a.2)");
          process.exit(1);
        }

        // Infer remote path if not provided
        let remotePath = options.remotePath;
        if (!remotePath) {
          // Default: skills/{skill-id}.md or {skill-id}.md
          remotePath = `skills/${skillId}.md`;
        }

        // Infer local path
        const localPath = path.join(os.homedir(), ".claude", "skills", `${skillId}.md`);

        // For MVP, we don't have real Git access, so use placeholder
        const lastSyncCommit = "00000000000000000000000000000000000000000"; // placeholder

        const entry: SkillManifestEntry = {
          id: skillId,
          name: skillId.replace(/-/g, " "),
          localPath,
          sourceRepo: {
            url: repoUrl,
            branch: options.branch,
            remotePath,
            lastSyncCommit,
          },
          available: true,
          localModified: false,
        };

        // Register in database
        const record = await manifestService.registerSkill(entry);

        console.log("✅ Skill registered successfully!");
        console.log(`   ID: ${record.skill_id}`);
        console.log(`   Local: ${record.local_path}`);
        console.log(`   Remote: ${record.source_repo_url}/blob/${record.source_repo_branch}/${record.source_repo_path}`);
        console.log("\nNext steps:");
        console.log(`  1. Save skill file to: ${localPath}`);
        console.log("  2. Run: /skill-check-upstream");
        console.log("  3. Run: /skill-contribute <skill-id> (if changes detected)");
      } catch (error) {
        console.error("❌ Registration failed:", error);
        process.exit(1);
      }
    });

  // List subcommand
  cmd
    .command("list")
    .option("--modified-only", "Show only modified skills")
    .option("--available-only", "Show only available skills")
    .description("List all registered skills")
    .action(async (options) => {
      try {
        let skills;

        if (options.modifiedOnly) {
          skills = await manifestService.listModifiedSkills();
        } else if (options.availableOnly) {
          skills = await manifestService.listAvailableSkills();
        } else {
          skills = await manifestService.listSkills();
        }

        if (skills.length === 0) {
          console.log("ℹ️  No skills registered. Run: /skill-manifest register <repo-url> <skill-id>");
          return;
        }

        console.log(`\n📋 Registered Skills (${skills.length})\n`);
        console.log("ID                          | Status     | Modified | Last Updated");
        console.log("-".repeat(70));

        for (const skill of skills) {
          const status = skill.is_available ? "✓ available" : "✗ unavailable";
          const modified = skill.is_locally_modified ? "yes" : "no";
          const updated = new Date(skill.updated_at).toLocaleDateString();

          const id = skill.skill_id.padEnd(27);
          const s = status.padEnd(10);
          const m = modified.padEnd(8);

          console.log(`${id} | ${s} | ${m} | ${updated}`);
        }
      } catch (error) {
        console.error("❌ List failed:", error);
        process.exit(1);
      }
    });

  // View subcommand
  cmd
    .command("view <skill-id>")
    .description("View skill manifest entry")
    .action(async (skillId) => {
      try {
        const skill = await manifestService.getSkillById(skillId);

        if (!skill) {
          console.error(`❌ Skill not found: ${skillId}`);
          process.exit(1);
        }

        console.log(`\n📖 Skill: ${skill.skill_name}`);
        console.log(`\nID:              ${skill.skill_id}`);
        console.log(`Local Path:      ${skill.local_path}`);
        console.log(`Remote Repo:     ${skill.source_repo_url}`);
        console.log(`Remote Branch:   ${skill.source_repo_branch}`);
        console.log(`Remote Path:     ${skill.source_repo_path}`);
        console.log(`Last Sync:       ${skill.last_sync_commit}`);
        console.log(`Available:       ${skill.is_available ? "✓ Yes" : "✗ No (404/unavailable)"}`);
        console.log(`Locally Modified: ${skill.is_locally_modified ? "✓ Yes" : "✗ No"}`);
        console.log(`Modification Count: ${skill.modification_count}`);
        console.log(`Created:         ${new Date(skill.created_at).toISOString()}`);
        console.log(`Updated:         ${new Date(skill.updated_at).toISOString()}`);
      } catch (error) {
        console.error("❌ View failed:", error);
        process.exit(1);
      }
    });

  // Diff subcommand (Phase 28a.3)
  if (options?.db) {
    const changeDetection = new ChangeDetectionService(options.db);

    cmd
      .command("diff <skill-id>")
      .option("--summary", "Show only line counts (default)")
      .option("--show-patch", "Show unified diff output")
      .description("Detect local changes vs upstream HEAD")
      .action(async (skillId, opts) => {
        try {
          // Validate skill-id format
          if (!/^[a-z0-9\-_]+$/.test(skillId)) {
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
          if (result.summary.status === "no-change") {
            console.log(`✅ ${result.skillName}`);
            console.log("   No changes detected. Local matches upstream.");
          } else if (result.summary.status === "modified") {
            console.log(`📝 ${result.skillName}`);
            console.log(
              `   ${result.summary.linesAdded} added, ${result.summary.linesDeleted} deleted, ${result.summary.linesModified} modified`
            );
            console.log(`   Change: ${result.summary.percentageChanged}% of content`);
            console.log(`   Last detected: ${result.summary.lastDetectedAt}`);

            if (opts.showPatch && result.unifiedDiff) {
              console.log("\n" + "=".repeat(60));
              console.log(result.unifiedDiff);
              console.log("=".repeat(60) + "\n");
            }
          }

          process.exit(0);
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          console.error(`❌ Command error: ${msg}`);
          process.exit(1);
        }
      });
  }

  return cmd;
}
