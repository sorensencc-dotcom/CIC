// SCP Status Tracker - Phase 28a.5
// GitHub PR polling for status updates, review state, and CI status
// Features: retry logic, rate limit handling, caching, atomic DB updates

import { Database } from "../db";
import {
  PRStatusSnapshot,
  PRStatusUpdate,
  ReviewState,
  SkillManifestRecord,
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
  private statusCache: Map<string, { snapshot: PRStatusSnapshot; timestamp: number }> =
    new Map();

  constructor(private db: Database, config?: StatusTrackerConfig) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;
    this.timeoutMs = config?.timeoutMs ?? 15000;
    this.cacheMinutes = config?.cacheMinutes ?? 5;
    this.githubToken = config?.githubToken || process.env.GITHUB_TOKEN || "";

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
      const reviewState = await this.getReviewStateWithRetry(
        owner,
        repo,
        prNumber,
        skillId
      );

      // Fetch commit status
      const commitStatus = await this.getCommitStatusWithRetry(
        owner,
        repo,
        pr.head.sha,
        skillId
      );

      const snapshot: PRStatusSnapshot = {
        prNumber,
        status: pr.merged ? "merged" : pr.state,
        reviewState,
        reviewComments: pr.review_comments || 0,
        commitStatus: commitStatus?.state || "pending",
        lastCheckedAt: new Date().toISOString() as ISO8601,
        checkedCount: 1,
      };

      // Cache result
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

    throw new Error("Max retries exceeded");
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

        // Determine state from reviews (last review wins)
        let state: ReviewState = "none";
        if (Array.isArray(reviews) && reviews.length > 0) {
          const lastReview = reviews[reviews.length - 1];
          if (lastReview.state === "APPROVED") state = "approved";
          else if (lastReview.state === "CHANGES_REQUESTED")
            state = "changes-requested";
          else if (lastReview.state === "COMMENTED") state = "pending";
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
      LIMIT 50
    `;
    return this.db.query(query, [skillId]);
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
      const [method, path] = endpoint.split(" ");
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
            const json = JSON.parse(data);

            if (res.statusCode >= 400) {
              const error = new Error(json.message || `HTTP ${res.statusCode}`);
              (error as any).statusCode = res.statusCode;
              reject(error);
              return;
            }

            // Handle rate limit
            if (res.statusCode === 429) {
              const resetTime = parseInt(res.headers["x-ratelimit-reset"]) * 1000;
              const waitMs = Math.max(0, resetTime - Date.now());
              const error = new Error(`Rate limited. Retry after ${Math.ceil(waitMs / 1000)}s`);
              (error as any).retryAfter = waitMs;
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

  // Clear cache (for testing)
  clearCache(): void {
    this.statusCache.clear();
  }
}
