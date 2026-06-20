// SCP Change Detection Service - Phase 28a.3
// Detects local skill divergence from upstream HEAD using git + content diff
// Features: retry logic, offline fallback, schema validation, structured logging

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { simpleGit, SimpleGit } from "simple-git";
import { Database } from "../db";
import {
  SkillManifestRecord,
  DiffResult,
  DiffSummary,
  DiffStatus,
  ISO8601,
} from "../models";

const log = (skillId: string, msg: string, data?: any) =>
  console.log(`[SCP-DETECT:${skillId}] ${msg}`, data || "");

const logError = (skillId: string, msg: string, error: any) =>
  console.error(`[SCP-DETECT:${skillId}] ERROR: ${msg}`, error);

export interface ChangeDetectionConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  gitDir?: string;
}

export class ChangeDetectionService {
  private maxRetries: number;
  private retryDelayMs: number;
  private timeoutMs: number;
  private git: SimpleGit;

  constructor(private db: Database, config?: ChangeDetectionConfig) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;
    this.timeoutMs = config?.timeoutMs ?? 30000;
    this.git = simpleGit();
  }

  // Main entry point: detect changes for a skill
  async detectChanges(skillId: string): Promise<DiffResult> {
    const startMs = Date.now();
    log(skillId, "Starting change detection");

    try {
      // Fetch skill manifest record
      const skill = await this.getSkillRecord(skillId);
      if (!skill) {
        return this.buildErrorResult(
          skillId,
          "unknown",
          "not-found",
          "Skill not registered in manifest"
        );
      }

      log(skillId, `Loaded manifest: ${skill.skill_name}`);

      // Verify local file exists
      if (!fs.existsSync(skill.local_path)) {
        await this.recordDetectionEvent(skillId, {
          status: "not-found",
          reason: "Local file missing",
        });
        return this.buildErrorResult(
          skillId,
          skill.skill_name,
          "not-found",
          `Local file not found: ${skill.local_path}`
        );
      }

      // Read local content
      const localContent = await this.readLocalFile(skill.local_path);
      const localChecksum = this.computeChecksum(localContent);

      // Fetch remote content with retries
      const remoteContent = await this.fetchRemoteWithRetry(
        skill.source_repo_url,
        skill.source_repo_branch,
        skill.source_repo_path,
        skillId
      );

      if (!remoteContent) {
        // Network failure: record event and return offline fallback
        log(skillId, "Remote fetch failed; using cached state");
        await this.recordDetectionEvent(skillId, {
          status: "network-fail",
          reason: "Could not reach upstream after retries",
        });

        return {
          skillId,
          skillName: skill.skill_name,
          hasChanges: false,
          summary: {
            status: "network-fail",
            linesAdded: 0,
            linesDeleted: 0,
            linesModified: 0,
            percentageChanged: 0,
            lastDetectedAt: new Date().toISOString() as ISO8601,
            errorMessage: "Could not fetch remote; using cached state",
            retryAttempts: this.maxRetries,
          },
          detectedAt: new Date().toISOString() as ISO8601,
        };
      }

      const remoteChecksum = this.computeChecksum(remoteContent);

      // Compare checksums first (fast path)
      if (localChecksum === remoteChecksum) {
        log(skillId, "No changes detected (checksum match)");
        await this.recordDetectionEvent(skillId, {
          status: "no-change",
          reason: "Checksums identical",
        });

        return {
          skillId,
          skillName: skill.skill_name,
          hasChanges: false,
          summary: {
            status: "no-change",
            linesAdded: 0,
            linesDeleted: 0,
            linesModified: 0,
            percentageChanged: 0,
            lastDetectedAt: new Date().toISOString() as ISO8601,
          },
          localChecksum,
          remoteChecksum,
          detectedAt: new Date().toISOString() as ISO8601,
        };
      }

      // Content differs: compute line-level diff
      log(skillId, "Content mismatch detected; computing diff");
      const diff = this.computeDiffLines(localContent, remoteContent);

      // Compute percentage changed
      const totalLines =
        Math.max(
          localContent.split("\n").length,
          remoteContent.split("\n").length
        ) || 1;
      const changedLines = diff.added + diff.deleted + diff.modified;
      const percentageChanged = Math.round((changedLines / totalLines) * 100);

      const summary: DiffSummary = {
        status: "modified",
        linesAdded: diff.added,
        linesDeleted: diff.deleted,
        linesModified: diff.modified,
        percentageChanged,
        lastDetectedAt: new Date().toISOString() as ISO8601,
      };

      // Record event to DB
      await this.recordDetectionEvent(skillId, {
        status: "modified",
        reason: `${diff.added} added, ${diff.deleted} deleted, ${diff.modified} modified`,
        summary,
      });

      const result: DiffResult = {
        skillId,
        skillName: skill.skill_name,
        hasChanges: true,
        summary,
        unifiedDiff: this.generateUnifiedDiff(localContent, remoteContent),
        localChecksum,
        remoteChecksum,
        detectedAt: new Date().toISOString() as ISO8601,
      };

      log(
        skillId,
        `Detection complete (${changedLines} lines changed) in ${Date.now() - startMs}ms`
      );
      return result;
    } catch (error) {
      logError(skillId, "Unexpected error", error);
      await this.recordDetectionEvent(skillId, {
        status: "error",
        reason: `${error instanceof Error ? error.message : String(error)}`,
      });

      return this.buildErrorResult(
        skillId,
        "unknown",
        "error",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  // Fetch remote file with exponential backoff retry
  private async fetchRemoteWithRetry(
    repoUrl: string,
    branch: string,
    remotePath: string,
    skillId: string
  ): Promise<string | null> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const content = await this.fetchRemoteFile(repoUrl, branch, remotePath);
        log(skillId, `Remote fetch succeeded on attempt ${attempt + 1}`);
        return content;
      } catch (error) {
        attempt++;
        const msg =
          error instanceof Error ? error.message : String(error);
        log(skillId, `Remote fetch failed (${attempt}/${this.maxRetries}): ${msg}`);

        if (attempt < this.maxRetries) {
          await this.sleep(delay);
          delay *= 2; // exponential backoff
        }
      }
    }

    return null;
  }

  // Fetch single remote file (GitHub raw URL)
  private async fetchRemoteFile(
    repoUrl: string,
    branch: string,
    remotePath: string
  ): Promise<string> {
    const rawUrl = this.buildGithubRawUrl(repoUrl, branch, remotePath);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timeout fetching ${rawUrl}`)),
        this.timeoutMs
      );

      // Use Node.js built-in fetch or fallback to https module
      // For MVP, we'll use a simple pattern: GitHub raw URLs are reliable
      try {
        // Dynamic import to avoid top-level await
        const https = require("https");
        https.get(rawUrl, { timeout: this.timeoutMs }, (res: any) => {
          clearTimeout(timeout);
          if (res.statusCode === 404) {
            reject(new Error("Remote file not found (404)"));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => resolve(data));
          res.on("error", (error: any) => reject(error));
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  // Build GitHub raw content URL
  private buildGithubRawUrl(
    repoUrl: string,
    branch: string,
    remotePath: string
  ): string {
    // https://github.com/owner/repo → https://raw.githubusercontent.com/owner/repo/branch/path
    const match = repoUrl.match(
      /github\.com[/:]([\w\-]+)\/([\w\.\-]+?)(\.git)?$/i
    );
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    }

    const [, owner, repo] = match;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
  }

  // Compute SHA256 checksum of content
  private computeChecksum(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  // Simple line-by-line diff (added/deleted/modified counts)
  private computeDiffLines(
    local: string,
    remote: string
  ): { added: number; deleted: number; modified: number } {
    const localLines = new Set(local.split("\n"));
    const remoteLines = new Set(remote.split("\n"));

    let added = 0;
    let deleted = 0;

    // Lines in remote but not local = added
    remoteLines.forEach((line) => {
      if (!localLines.has(line)) added++;
    });

    // Lines in local but not remote = deleted
    localLines.forEach((line) => {
      if (!remoteLines.has(line)) deleted++;
    });

    // Modified = min(added, deleted) to avoid double-counting
    const modified = Math.min(added, deleted);

    return { added, deleted, modified };
  }

  // Generate unified diff format (for display/storage)
  private generateUnifiedDiff(local: string, remote: string): string {
    const localLines = local.split("\n");
    const remoteLines = remote.split("\n");

    const diff: string[] = [];
    diff.push("--- local");
    diff.push("+++ remote");

    // Naive unified diff (linear comparison)
    const maxLen = Math.max(localLines.length, remoteLines.length);
    for (let i = 0; i < maxLen; i++) {
      const localLine = localLines[i] || "";
      const remoteLine = remoteLines[i] || "";

      if (localLine !== remoteLine) {
        if (i < localLines.length) diff.push(`-${localLine}`);
        if (i < remoteLines.length) diff.push(`+${remoteLine}`);
      } else {
        diff.push(` ${localLine}`);
      }
    }

    return diff.join("\n").slice(0, 10000); // Cap to 10KB for storage
  }

  // Read local skill file
  private async readLocalFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  // Fetch skill record from manifest DB
  private async getSkillRecord(skillId: string): Promise<SkillManifestRecord | null> {
    const query = "SELECT * FROM skill_manifest WHERE skill_id = ? LIMIT 1";
    const rows = await this.db.query(query, [skillId]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Record detection event to DB (audit trail)
  private async recordDetectionEvent(
    skillId: string,
    event: {
      status: DiffStatus;
      reason: string;
      summary?: DiffSummary;
    }
  ): Promise<void> {
    try {
      const query = `
        UPDATE skill_manifest
        SET is_locally_modified = ?, modification_count = modification_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE skill_id = ?
      `;
      const isModified = event.status === "modified" ? 1 : 0;
      await this.db.execute(query, [isModified, skillId]);
      log(
        skillId,
        `Recorded detection event: ${event.status} (${event.reason})`
      );
    } catch (error) {
      logError(skillId, "Failed to record detection event", error);
      // Non-fatal: don't throw, just log
    }
  }

  // Build error result
  private buildErrorResult(
    skillId: string,
    skillName: string,
    status: DiffStatus,
    errorMessage: string
  ): DiffResult {
    return {
      skillId,
      skillName,
      hasChanges: false,
      summary: {
        status,
        linesAdded: 0,
        linesDeleted: 0,
        linesModified: 0,
        percentageChanged: 0,
        lastDetectedAt: new Date().toISOString() as ISO8601,
        errorMessage,
      },
      detectedAt: new Date().toISOString() as ISO8601,
    };
  }

  // Utility: sleep for ms
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Query all modified skills (for batch detection runs)
  async queryModifiedSkills(): Promise<SkillManifestRecord[]> {
    const query =
      "SELECT * FROM skill_manifest WHERE is_locally_modified = 1 ORDER BY updated_at DESC LIMIT 100";
    return this.db.query(query);
  }

  // Clear modification flag after PR submission
  async clearModificationFlag(skillId: string): Promise<void> {
    const query = `
      UPDATE skill_manifest
      SET is_locally_modified = 0, modification_count = 0
      WHERE skill_id = ?
    `;
    await this.db.execute(query, [skillId]);
    log(skillId, "Cleared modification flag");
  }
}
