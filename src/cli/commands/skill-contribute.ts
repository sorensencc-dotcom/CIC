// SCP Skill Contribute Command - Phase 28a.4
// /skill-manifest contribute <skill-id>

import { Command } from "commander";
import { ContributionAgent } from "../../governance/services/contribution-agent";
import { ChangeDetectionService } from "../../governance/services/change-detection-service";
import { ManifestService } from "../../governance/services/manifest-service";
import { Database } from "../../governance/db";

export function createContributeCommand(
  manifestService: ManifestService,
  db?: Database
): Command {
  if (!db) {
    return new Command("contribute")
      .description("Create PR from detected changes")
      .argument("<skill-id>")
      .action(() => {
        console.error(
          "❌ Database not initialized. Cannot create contributions."
        );
        throw new Error("DB required for contribute command");
      });
  }

  const changeDetection = new ChangeDetectionService(db);
  const contributor = new ContributionAgent(db);

  return new Command("contribute")
    .description("Create PR from detected changes")
    .argument("<skill-id>", "Skill identifier")
    .action(async (skillId) => {
      try {
        // Validate skill-id format
        if (!/^[a-z0-9\-_]+$/.test(skillId)) {
          throw new Error(
            "Invalid skill-id. Use lowercase letters, numbers, dash, underscore only."
          );
        }

        console.log(`📤 Creating PR for: ${skillId}`);

        // Fetch skill manifest
        const skill = await manifestService.getSkillById(skillId);
        if (!skill) {
          throw new Error(
            `Skill not found: ${skillId}. Register with: /skill-manifest register <url> ${skillId}`
          );
        }

        console.log(`   Skill: ${skill.skill_name}`);

        // Detect changes
        console.log(`   Checking for changes...`);
        const diffResult = await changeDetection.detectChanges(skillId);

        if (!diffResult.hasChanges) {
          console.log("   ℹ️  No changes detected. Skipping PR creation.");
          return;
        }

        console.log(
          `   ✓ Changes found: ${diffResult.summary.linesAdded} added, ${diffResult.summary.linesDeleted} deleted`
        );

        // Create PR
        console.log(`   Creating PR...`);
        const prResult = await contributor.createPullRequest({
          skillId,
          skillName: skill.skill_name,
          upstreamRepoUrl: skill.source_repo_url,
          upstreamBranch: skill.source_repo_branch,
          localFilePath: skill.local_path,
          diffSummary: diffResult.summary,
        });

        console.log(`\n✅ PR Created!\n`);
        console.log(`   PR #${prResult.prNumber}`);
        console.log(`   URL: ${prResult.prUrl}`);
        console.log(`   Branch: ${prResult.prBranch}`);
        console.log(`   Status: ${prResult.status}`);
        console.log(`   Commit: ${prResult.commitSha.slice(0, 7)}\n`);
        console.log(`Next: Check PR status with: /skill-manifest status ${skillId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error: ${msg}`);
        throw error;
      }
    });
}
