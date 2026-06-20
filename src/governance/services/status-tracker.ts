// SCP Status Tracker - Phase 28a.5
// GitHub PR polling for status updates, review state, and CI status
// Features: retry logic, rate limit handling, caching, atomic DB updates
// Governance: Phase 24.5 integration for merged/closed event recording

import { Database } from "../db";
import { SCPGovernanceBridge } from "./scp-governance-bridge";
import {
  PRStatusSnapshot,
  PRStatusUpdate,
  ReviewState,
  SkillManifestRecord,
  SkillContribution,
  ISO8601,
} from "../models";

const log = (skillId: string, prNumber: number, msg: string) =>
  console.log(`[SCP-STATUS:${skillId}#${prNumber}] ${msg}`);

const logError = (skillId: string, prNumber: number, msg: string, error: any) =>
  console.error(`[SCP-STATUS:${skillId}#${prNumber}] ERROR: ${msg}`, error);

interface StatusTrackerConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  cacheMinutes?: number;
  githubToken?: string;
}

export class StatusTracker {
  private maxRetries: number;
  private retryDelayMs: number;
  private timeoutMs: number;
  private cacheMinutes: number;
  private githubToken: string;
  private governanceBridge: SCPGovernanceBridge;
  private statusCache: Map<string, { snapshot: PRStatusSnapshot; timestamp: number }> =
    new Map();

  constructor(private db: Database, config?: StatusTrackerConfig) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;
    this.timeoutMs = config?.timeoutMs ?? 15000;
    this.cacheMinutes = config?.cacheMinutes ?? 5;
    this.githubToken = config?.githubToken || process.env.GITHUB_TOKEN || "";
    this.governanceBridge = new SCPGovernanceBridge(db);

    if (!this.githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
  }

  // Check status of single PR
  async checkPRStatus(
    skillId: string,
    prNumber: number,
    repoUrl: string
  ): Promise<PRStatusSnapshot> {
    const cacheKey = `${skillId}#${prNumber}`;
    const cached = this.statusCache.get(cacheKey);

    // Return cached if fresh (< 5 min old)
    if (cached && Date.now() - cached.timestamp < this.cacheMinutes * 60 * 1000) {
      log(skillId, prNumber, "Returning cached status");
      return cached.snapshot;
    }

    try {
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      log(skillId, prNumber, `Checking ${owner}/${repo}`);

      // Fetch PR details
      const pr = await this.getPRWithRetry(owner, repo, prNumber, skillId);
      if (!pr) {
        throw new Error("PR not found (404)");
      }

      // Fetch review state
      let reviewState: ReviewState;
      try {
        reviewState = await this.getReviewStateWithRetry(
          owner,
          repo,
          prNumber,
          skillId
        );
      } catch (error) {
        // Don't cache if review fetch fails mid-call
        throw error;
      }

      // Fetch commit status
      let commitStatus: any;
      try {
        commitStatus = await this.getCommitStatusWithRetry(
          owner,
          repo,
          pr.head?.sha || "",
          skillId
        );
      } catch (error) {
        // Don't cache if commit status fetch fails mid-call
        throw error;
      }

      const snapshot: PRStatusSnapshot = {
        prNumber,
        status: pr.merged ? "merged" : pr.state,
        reviewState,
        reviewComments: pr.review_comments || 0,
        commitStatus: commitStatus?.state || "pending",
        lastCheckedAt: new Date().toISOString() as ISO8601,
        checkedCount: 1,
      };

      // Cache only after all 3 API calls succeeded
      this.statusCache.set(cacheKey, {
        snapshot,
        timestamp: Date.now(),
      });

      log(skillId, prNumber, `Status: ${snapshot.status} / Review: ${reviewState}`);
      return snapshot;
    } catch (error) {
      logError(skillId, prNumber, "Status check failed", error);
      throw error;
    }
  }

  // Check all PRs for a skill
  async checkAllPRsForSkill(skillId: string): Promise<PRStatusSnapshot[]> {
    try {
      const skill = await this.getSkillRecord(skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${skillId}`);
      }

      // Get all open PRs for this skill
      const contributions = await this.getOpenContributions(skillId);
      if (contributions.length === 0) {
        log(skillId, 0, "No open contributions found");
        return [];
      }

      log(skillId, 0, `Checking ${contributions.length} open PRs`);

      const results: PRStatusSnapshot[] = [];
      for (const contrib of contributions) {
        try {
          const snapshot = await this.checkPRStatus(
            skillId,
            contrib.pr_number,
            contrib.upstream_repo_url
          );
          results.push(snapshot);

          // Update DB
          await this.recordStatusUpdate(skillId, snapshot);
        } catch (error) {
          logError(skillId, contrib.pr_number, "Failed to check", error);
          // Non-fatal: continue checking other PRs
        }
      }

      return results;
    } catch (error) {
      logError(skillId, 0, "Batch check failed", error);
      throw error;
    }
  }

  // Fetch PR with retry
  private async getPRWithRetry(
    owner: string,
    repo: string,
    prNumber: number,
    skillId: string
  ): Promise<any> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        return await this.githubRequest(
          `GET /repos/${owner}/${repo}/pulls/${prNumber}`,
          null
        );
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);

        // 404 = PR not found (permanent, don't retry)
        if (msg.includes("404")) {
          throw error;
        }

        log(skillId, prNumber, `Fetch PR failed (${attempt}/${this.maxRetries}): ${msg}`);

        if (attempt < this.maxRetries) {
          await this.sleep(delay);
          delay *= 2;
        } else {
          throw error;
        }
      }
    }
  }

  // Get review state from PR reviews
  private async getReviewStateWithRetry(
    owner: string,
    repo: string,
    prNumber: number,
    skillId: string
  ): Promise<ReviewState> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const reviews = await this.githubRequest(
          `GET /repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
          null
        );

        // Determine state from reviews (track latest APPROVED/CHANGES_REQUESTED)
        let state: ReviewState = "none";
        if (Array.isArray(reviews) && reviews.length > 0) {
          // Iterate to find latest state, not assuming chronological order
          for (const review of reviews) {
            if (review.state === "APPROVED") state = "approved";
            else if (review.state === "CHANGES_REQUESTED") state = "changes-requested";
          }
          // If no approval/rejection, check for comments
          if (state === "none") {
            const hasComments = reviews.some((r) => r.state === "COMMENTED");
            if (hasComments) state = "pending";
          }
        }

        return state;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, prNumber, `Get reviews failed (${attempt}/${this.maxRetries})`);

        if (attempt < this.maxRetries) {
          await this.sleep(delay);
          delay *= 2;
        } else {
          // Non-fatal: return none
          return "none";
        }
      }
    }

    return "none";
  }

  // Get commit status (CI checks)
  private async getCommitStatusWithRetry(
    owner: string,
    repo: string,
    commitSha: string,
    skillId: string
  ): Promise<any> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        return await this.githubRequest(
          `GET /repos/${owner}/${repo}/commits/${commitSha}/status`,
          null
        );
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, 0, `Get commit status failed (${attempt}/${this.maxRetries})`);

        if (attempt < this.maxRetries) {
          await this.sleep(delay);
          delay *= 2;
        } else {
          // Non-fatal: return null
          return null;
        }
      }
    }

    return null;
  }

  // Record status update to DB
  private async recordStatusUpdate(
    skillId: string,
    snapshot: PRStatusSnapshot
  ): Promise<void> {
    try {
      const query = `
        UPDATE skill_contributions
        SET status = ?,
            review_comments = ?,
            last_checked_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE skill_id = ? AND pr_number = ?
      `;

      await this.db.execute(query, [
        snapshot.status,
        snapshot.reviewComments,
        snapshot.lastCheckedAt,
        skillId,
        snapshot.prNumber,
      ]);

      log(skillId, snapshot.prNumber, "Status recorded to DB");
    } catch (error) {
      logError(skillId, snapshot.prNumber, "Failed to record status", error);
      // Non-fatal: don't throw
    }
  }

  // Get skill record from DB
  private async getSkillRecord(skillId: string): Promise<SkillManifestRecord | null> {
    const query = "SELECT * FROM skill_manifest WHERE skill_id = ? LIMIT 1";
    const rows = await this.db.query(query, [skillId]);
    return rows.length > 0 ? rows[0] : null;
  }

  // Get open contributions for skill
  private async getOpenContributions(skillId: string): Promise<any[]> {
    const query = `
      SELECT skill_id, pr_number, pr_url, upstream_repo_url, status
      FROM skill_contributions
      WHERE skill_id = ? AND status IN ('open', 'draft')
      ORDER BY created_at DESC
      LIMIT 51
    `;
    const results = await this.db.query(query, [skillId]);

    if (results.length >= 51) {
      log(skillId, 0, `⚠️  Skill has 51+ open PRs. Checking only first 50 (pagination needed)`);
      return results.slice(0, 50);
    }

    return results;
  }

  // Parse repository URL
  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(
      /github\.com[/:]([\w\-]+)\/([\w\.\-]+?)(\.git)?$/i
    );
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    }

    return { owner: match[1], repo: match[2] };
  }

  // GitHub API request
  private async githubRequest(endpoint: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const parts = endpoint.split(" ");
      if (parts.length < 2) {
        reject(new Error(`Invalid endpoint format: ${endpoint}. Expected "METHOD /path"`));
        return;
      }
      const [method, path] = parts;
      const https = require("https");

      const options = {
        hostname: "api.github.com",
        path,
        method,
        headers: {
          Authorization: `token ${this.githubToken}`,
          "User-Agent": "SCP/1.0",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        timeout: this.timeoutMs,
      };

      const req = https.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            // Prevent unbounded JSON parsing (10MB max)
            if (data.length > 10 * 1024 * 1024) {
              reject(new Error("Response too large (>10MB)"));
              return;
            }
            const json = JSON.parse(data);

            // Handle rate limit (before other 4xx errors)
            if (res.statusCode === 429) {
              const resetTime = parseInt(res.headers["x-ratelimit-reset"]) * 1000;
              const waitMs = Math.max(0, resetTime - Date.now());
              const error = new Error(`Rate limited. Retry after ${Math.ceil(waitMs / 1000)}s`);
              (error as any).retryAfter = waitMs;
              reject(error);
              return;
            }

            if (res.statusCode >= 400) {
              const error = new Error(json.message || `HTTP ${res.statusCode}`);
              (error as any).statusCode = res.statusCode;
              reject(error);
              return;
            }

            resolve(json);
          } catch (parseError) {
            reject(parseError);
          }
        });
        res.on("error", reject);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`GitHub API timeout after ${this.timeoutMs}ms`));
      });

      req.on("error", reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // Utility: sleep
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Check status and record governance events on merge/close (Phase 24.5)
  async checkAndUpdatePRStatus(
    skillId: string,
    prNumber: number,
    repoUrl: string,
    skillName: string
  ): Promise<PRStatusSnapshot> {
    const cacheKey = `${skillId}#${prNumber}`;

    try {
      // Get current status
      const snapshot = await this.checkPRStatus(skillId, prNumber, repoUrl);

      // Get previous status from DB
      const rows = await this.db.query(
        "SELECT status FROM skill_contributions WHERE skill_id = ? AND pr_number = ?",
        [skillId, prNumber]
      );

      const previousStatus = rows[0]?.status || "unknown";
      const newStatus = snapshot.status;

      // Detect status change to merged or closed
      if (previousStatus === "open" && (newStatus === "merged" || newStatus === "closed")) {
        log(skillId, prNumber, `Status changed: ${previousStatus} → ${newStatus}`);

        // Update database
        await this.db.execute(
          "UPDATE skill_contributions SET status = ?, status_updated_at = CURRENT_TIMESTAMP WHERE skill_id = ? AND pr_number = ?",
          [newStatus, skillId, prNumber]
        );

        // Record governance event (Phase 24.5)
        try {
          const contrib: SkillContribution = {
            skillId,
            skillName,
            prNumber,
            upstreamRepo: repoUrl,
            prUrl: "", // TODO: fetch from DB if needed
            status: newStatus as any,
            createdAt: new Date().toISOString() as ISO8601,
            lastChecked: new Date().toISOString() as ISO8601,
            author: "scp-bot",
            type: "feature",
            description: `PR ${newStatus}`,
          };

          const lineageId = await this.governanceBridge.recordContributionEvent(
            contrib,
            newStatus as "merged" | "closed"
          );

          log(
            skillId,
            prNumber,
            `Recorded governance event (lineage #${lineageId}) for ${newStatus}`
          );

          // Link to lineage if not already linked
          await this.db.execute(
            "UPDATE skill_contributions SET linked_skill_lineage_id = ? WHERE skill_id = ? AND pr_number = ? AND linked_skill_lineage_id IS NULL",
            [lineageId, skillId, prNumber]
          );
        } catch (govError) {
          logError(
            skillId,
            prNumber,
            "Failed to record governance event",
            govError
          );
          // Non-fatal: status already updated, governance linking is best-effort
        }
      } else if (newStatus !== previousStatus) {
        // Other status changes (e.g. open → draft), just update DB
        await this.db.execute(
          "UPDATE skill_contributions SET status = ?, status_updated_at = CURRENT_TIMESTAMP WHERE skill_id = ? AND pr_number = ?",
          [newStatus, skillId, prNumber]
        );
        log(skillId, prNumber, `Status updated: ${previousStatus} → ${newStatus}`);
      }

      return snapshot;
    } catch (error) {
      logError(skillId, prNumber, "Check and update status failed", error);
      throw error;
    }
  }

  // Clear cache (for testing)
  clearCache(): void {
    this.statusCache.clear();
  }
}
