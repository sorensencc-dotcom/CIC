// SCP Scheduler - Phase 28a.7
// Automated scheduling for skill contribution pipeline
// Tasks: daily change detection, batch PR creation, weekly reports, cleanup

import { Database } from "../db";
import { ChangeDetectionService } from "./change-detection-service";
import { ContributionAgent } from "./contribution-agent";
import { StatusTracker } from "./status-tracker";
import { Notifier } from "./notifier";

const log = (msg: string) => console.log(`[SCP-SCHEDULER] ${msg}`);
const logError = (msg: string, error: any) =>
  console.error(`[SCP-SCHEDULER] ERROR: ${msg}`, error);

interface SchedulerConfig {
  dailyRunTime?: string; // "00:00" UTC (default: "00:00")
  weeklyRunDay?: number; // 0=Sunday, 1=Monday, etc (default: 0 = Sunday)
  cleanupDaysOld?: number; // Archive contributions older than N days (default: 90)
}

export class Scheduler {
  private dailyRunTime: string;
  private weeklyRunDay: number;
  private cleanupDaysOld: number;
  private changeDetection: ChangeDetectionService;
  private contributor: ContributionAgent;
  private tracker: StatusTracker;
  private notifier: Notifier;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private db: Database, config?: SchedulerConfig) {
    this.dailyRunTime = config?.dailyRunTime || "00:00";
    this.weeklyRunDay = config?.weeklyRunDay ?? 0;
    this.cleanupDaysOld = config?.cleanupDaysOld ?? 90;

    this.changeDetection = new ChangeDetectionService(db);
    this.contributor = new ContributionAgent(db);
    this.tracker = new StatusTracker(db);
    this.notifier = new Notifier(db);
  }

  // Start all scheduled tasks
  start(): void {
    log("Starting scheduler...");
    this.scheduleDailyRun();
    this.scheduleWeeklyReport();
    this.scheduleCleanup();
    log("Scheduler started");
  }

  // Stop all scheduled tasks
  stop(): void {
    log("Stopping scheduler...");
    for (const [key, timer] of this.timers.entries()) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    log("Scheduler stopped");
  }

  // Schedule daily change detection at 00:00 UTC
  private scheduleDailyRun(): void {
    const [hours, minutes] = this.dailyRunTime.split(":").map(Number);
    const now = new Date();
    const nextRun = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes)
    );

    // If time has passed today, schedule for tomorrow
    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    const delayMs = nextRun.getTime() - now.getTime();
    log(`Daily run scheduled for ${nextRun.toISOString()} (in ${Math.floor(delayMs / 1000)}s)`);

    const timer = setTimeout(() => {
      this.runDailyChangeDetection();
      // Reschedule for tomorrow
      this.scheduleDailyRun();
    }, delayMs);

    this.timers.set("daily-run", timer);
  }

  // Schedule weekly report at Sunday 02:00 UTC
  private scheduleWeeklyReport(): void {
    const now = new Date();
    const nextRun = new Date(now);

    // Calculate days until weekly run day
    const daysDiff = (this.weeklyRunDay - now.getUTCDay() + 7) % 7;
    nextRun.setUTCDate(nextRun.getUTCDate() + (daysDiff === 0 ? 7 : daysDiff));
    nextRun.setUTCHours(2, 0, 0, 0);

    // If we're on the right day but time passed, schedule for next week
    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 7);
    }

    const delayMs = nextRun.getTime() - now.getTime();
    log(
      `Weekly report scheduled for ${nextRun.toISOString()} (in ${Math.floor(delayMs / 1000)}s)`
    );

    const timer = setTimeout(() => {
      this.runWeeklyReport();
      // Reschedule for next week
      this.scheduleWeeklyReport();
    }, delayMs);

    this.timers.set("weekly-report", timer);
  }

  // Schedule cleanup at 03:00 UTC daily
  private scheduleCleanup(): void {
    const now = new Date();
    const nextRun = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0)
    );

    if (nextRun.getTime() <= now.getTime()) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    const delayMs = nextRun.getTime() - now.getTime();
    log(`Cleanup scheduled for ${nextRun.toISOString()} (in ${Math.floor(delayMs / 1000)}s)`);

    const timer = setTimeout(() => {
      this.runCleanup();
      // Reschedule for tomorrow
      this.scheduleCleanup();
    }, delayMs);

    this.timers.set("cleanup", timer);
  }

  // Daily: run change detection for all skills + create PRs for modified ones
  private async runDailyChangeDetection(): Promise<void> {
    log("Running daily change detection...");

    try {
      // Get all registered skills
      const skills = await this.db.query(
        "SELECT skill_id, skill_name, source_repo_url, source_repo_branch, local_path FROM skill_manifest WHERE is_available = 1"
      );

      if (skills.length === 0) {
        log("No skills to check");
        return;
      }

      log(`Checking ${skills.length} skills for changes...`);

      let modified = 0;
      let contributed = 0;

      for (const skill of skills) {
        try {
          // Detect changes
          const result = await this.changeDetection.detectChanges(skill.skill_id);

          if (!result.hasChanges) {
            continue;
          }

          modified++;
          log(`Found changes in ${skill.skill_id} (+${result.summary.linesAdded})`);

          // Create PR automatically
          try {
            const prResult = await this.contributor.createPullRequest({
              skillId: skill.skill_id,
              skillName: skill.skill_name,
              upstreamRepoUrl: skill.source_repo_url,
              upstreamBranch: skill.source_repo_branch,
              localFilePath: skill.local_path,
              diffSummary: result.summary,
            });

            contributed++;
            log(`PR created: ${skill.skill_id} (#${prResult.prNumber})`);

            // Notify submission
            await this.notifier.notifySubmitted(
              skill.skill_id,
              skill.skill_name,
              prResult.prNumber,
              prResult.prUrl,
              result.summary.linesAdded,
              result.summary.linesDeleted
            );
          } catch (prError) {
            logError(`Failed to create PR for ${skill.skill_id}`, prError);
            // Non-fatal: continue
          }
        } catch (detectionError) {
          logError(`Failed to detect changes in ${skill.skill_id}`, detectionError);
          // Non-fatal: continue
        }
      }

      log(
        `Daily run complete: ${modified} modified, ${contributed} PRs created (out of ${skills.length} skills)`
      );
    } catch (error) {
      logError("Daily change detection failed", error);
    }
  }

  // Weekly: generate summary report of contributions
  private async runWeeklyReport(): Promise<void> {
    log("Generating weekly contribution report...");

    try {
      // Get stats for past 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const stats = await this.db.query(
        `
        SELECT
          COUNT(*) as total_prs,
          SUM(CASE WHEN status = 'merged' THEN 1 ELSE 0 END) as merged,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
        FROM skill_contributions
        WHERE created_at >= ?
        `,
        [sevenDaysAgo.toISOString()]
      );

      const record = stats[0] || {};
      log(
        `Weekly report: ${record.total_prs || 0} PRs (${record.merged || 0} merged, ${record.open || 0} open, ${record.closed || 0} closed)`
      );

      // TODO: Send report to Slack weekly-reports channel or email
    } catch (error) {
      logError("Weekly report generation failed", error);
    }
  }

  // Cleanup: archive old contribution records
  private async runCleanup(): Promise<void> {
    log(`Running cleanup (archiving records older than ${this.cleanupDaysOld} days)...`);

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.cleanupDaysOld);

      // Move old closed/merged contributions to archive table (or just flag)
      const affected = await this.db.execute(
        `
        UPDATE skill_contributions
        SET archived = 1, archived_at = CURRENT_TIMESTAMP
        WHERE (status = 'merged' OR status = 'closed')
          AND created_at < ?
          AND archived = 0
        `,
        [cutoffDate.toISOString()]
      );

      log(`Cleanup complete: ${affected.affectedRows || 0} records archived`);
    } catch (error) {
      logError("Cleanup failed", error);
    }
  }
}
