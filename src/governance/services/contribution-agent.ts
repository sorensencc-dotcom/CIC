// SCP Contribution Agent - Phase 28a.4
// GitHub PR creation from detected skill changes
// Features: retry logic, rate limit handling, atomic recording, GitHub API v3
// Governance: Phase 24.5 integration for skill lineage tracking

import * as fs from "fs";
import * as path from "path";
import { Database } from "../db";
import { SCPGovernanceBridge } from "./scp-governance-bridge";
import {
  PRCreationRequest,
  PRCreationResult,
  GitHubContributionMetadata,
  SkillContribution,
  SkillManifestRecord,
  ISO8601,
} from "../models";

const log = (skillId: string, msg: string, data?: any) =>
  console.log(`[SCP-CONTRIB:${skillId}] ${msg}`, data || "");

const logError = (skillId: string, msg: string, error: any) =>
  console.error(`[SCP-CONTRIB:${skillId}] ERROR: ${msg}`, error);

export interface ContributionAgentConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  githubToken?: string;
}

export class ContributionAgent {
  private maxRetries: number;
  private retryDelayMs: number;
  private timeoutMs: number;
  private githubToken: string;
  private governanceBridge: SCPGovernanceBridge;

  constructor(private db: Database, config?: ContributionAgentConfig) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 2000;
    this.timeoutMs = config?.timeoutMs ?? 30000;
    this.githubToken = config?.githubToken || process.env.GITHUB_TOKEN || "";
    this.governanceBridge = new SCPGovernanceBridge(db);

    if (!this.githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
  }

  // Main entry point: create PR from detected changes
  async createPullRequest(req: PRCreationRequest): Promise<PRCreationResult> {
    const startMs = Date.now();
    log(req.skillId, "Starting PR creation");

    try {
      // Validate request
      if (!req.diffSummary.status || req.diffSummary.status === "no-change") {
        throw new Error("No changes detected. Cannot create PR.");
      }

      // Parse GitHub URL
      const metadata = this.parseGitHubUrl(
        req.upstreamRepoUrl,
        req.skillId,
        req.diffSummary
      );
      log(
        req.skillId,
        `Parsed: ${metadata.owner}/${metadata.repo} branch:${metadata.branch}`
      );

      // Read local skill file
      const fileContent = await this.readSkillFile(req.localFilePath);
      log(req.skillId, `Read local file (${fileContent.length} bytes)`);

      // Get default branch SHA (to base PR on latest)
      const defaultBranchSha = await this.getDefaultBranchShaWithRetry(
        metadata.owner,
        metadata.repo,
        req.upstreamBranch,
        req.skillId
      );
      log(req.skillId, `Base SHA: ${defaultBranchSha.slice(0, 7)}`);

      // Create contribution branch
      const branchSha = await this.createBranchWithRetry(
        metadata.owner,
        metadata.repo,
        metadata.branch,
        defaultBranchSha,
        req.skillId
      );
      log(req.skillId, `Created branch: ${metadata.branch}`);

      // Commit file to branch
      const commitSha = await this.commitFileWithRetry(
        metadata.owner,
        metadata.repo,
        metadata.branch,
        path.basename(req.localFilePath),
        fileContent,
        metadata.commitMessage,
        req.skillId
      );
      log(req.skillId, `Committed: ${commitSha.slice(0, 7)}`);

      // Create PR
      const prResult = await this.createPRWithRetry(
        metadata.owner,
        metadata.repo,
        req.upstreamBranch,
        metadata.branch,
        metadata.prTitle,
        metadata.prDescription,
        req.skillId
      );
      log(req.skillId, `Created PR #${prResult.number}`);

      // Record contribution to DB + governance lineage
      await this.recordContributionToDB(
        req.skillId,
        req.skillName,
        prResult,
        metadata,
        commitSha,
        req.diffSummary
      );

      const result: PRCreationResult = {
        skillId: req.skillId,
        prNumber: prResult.number,
        prUrl: prResult.html_url,
        prBranch: metadata.branch,
        commitSha,
        createdAt: new Date().toISOString() as ISO8601,
        status: prResult.draft ? "draft" : "open",
      };

      log(
        req.skillId,
        `PR creation complete in ${Date.now() - startMs}ms: ${result.prUrl}`
      );
      return result;
    } catch (error) {
      logError(req.skillId, "PR creation failed", error);
      throw error;
    }
  }

  // Parse GitHub URL and build metadata
  private parseGitHubUrl(
    repoUrl: string,
    skillId: string,
    diffSummary: any
  ): GitHubContributionMetadata {
    const match = repoUrl.match(
      /github\.com[/:]([\w\-]+)\/([\w\.\-]+?)(\.git)?$/i
    );
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    }

    const [, owner, repo] = match;
    const branch = `scp-contrib/${skillId}-${Date.now()}`;

    const commitMessage =
      `[SCP] Update ${skillId}\n\n` +
      `Lines added: ${diffSummary.linesAdded}\n` +
      `Lines deleted: ${diffSummary.linesDeleted}\n` +
      `Change: ${diffSummary.percentageChanged}%\n\n` +
      `Submitted by Skill Contribution Pipeline (Phase 28a)`;

    const prTitle = `[SCP] Update ${skillId}`;
    const prDescription =
      `## Skill Contribution\n\n` +
      `**Skill:** ${skillId}\n` +
      `**Status:** Auto-submitted by Skill Contribution Pipeline\n\n` +
      `### Changes\n` +
      `- Lines added: ${diffSummary.linesAdded}\n` +
      `- Lines deleted: ${diffSummary.linesDeleted}\n` +
      `- Total change: ${diffSummary.percentageChanged}%\n\n` +
      `**Phase:** 28a (SCP v1.0)\n` +
      `**Timestamp:** ${new Date().toISOString()}`;

    return {
      owner,
      repo,
      branch,
      commitMessage,
      prTitle,
      prDescription,
    };
  }

  // Get SHA of default branch (main/master)
  private async getDefaultBranchShaWithRetry(
    owner: string,
    repo: string,
    branch: string,
    skillId: string
  ): Promise<string> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const ref = await this.getGitHubRef(owner, repo, `heads/${branch}`);
        return ref.object.sha;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, `Get default branch failed (${attempt}/${this.maxRetries}): ${msg}`);

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

  // Create branch from base SHA
  private async createBranchWithRetry(
    owner: string,
    repo: string,
    branch: string,
    baseSha: string,
    skillId: string
  ): Promise<string> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const ref = await this.createGitHubRef(owner, repo, `refs/heads/${branch}`, baseSha);
        return ref.object.sha;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, `Create branch failed (${attempt}/${this.maxRetries}): ${msg}`);

        // 422 = branch already exists, that's OK (retry failed before)
        if (msg.includes("422")) {
          log(skillId, "Branch exists from prior attempt, using it");
          return baseSha;
        }

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

  // Commit file to branch
  private async commitFileWithRetry(
    owner: string,
    repo: string,
    branch: string,
    filename: string,
    content: string,
    message: string,
    skillId: string
  ): Promise<string> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const base64Content = Buffer.from(content).toString("base64");
        const commit = await this.putGitHubFile(
          owner,
          repo,
          branch,
          filename,
          base64Content,
          message
        );
        return commit.commit.sha;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, `Commit file failed (${attempt}/${this.maxRetries}): ${msg}`);

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

  // Create PR
  private async createPRWithRetry(
    owner: string,
    repo: string,
    base: string,
    head: string,
    title: string,
    description: string,
    skillId: string
  ): Promise<any> {
    let attempt = 0;
    let delay = this.retryDelayMs;

    while (attempt < this.maxRetries) {
      try {
        const pr = await this.postGitHubPR(
          owner,
          repo,
          base,
          head,
          title,
          description
        );
        return pr;
      } catch (error) {
        attempt++;
        const msg = error instanceof Error ? error.message : String(error);
        log(skillId, `Create PR failed (${attempt}/${this.maxRetries}): ${msg}`);

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

  // GitHub API: Get ref
  private async getGitHubRef(owner: string, repo: string, ref: string): Promise<any> {
    return this.githubRequest(
      `GET /repos/${owner}/${repo}/git/refs/${ref}`,
      null
    );
  }

  // GitHub API: Create ref
  private async createGitHubRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string
  ): Promise<any> {
    return this.githubRequest(
      `POST /repos/${owner}/${repo}/git/refs`,
      { ref, sha }
    );
  }

  // GitHub API: Put file (commit)
  private async putGitHubFile(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string
  ): Promise<any> {
    return this.githubRequest(
      `PUT /repos/${owner}/${repo}/contents/${path}`,
      { message, content, branch }
    );
  }

  // GitHub API: Create PR
  private async postGitHubPR(
    owner: string,
    repo: string,
    base: string,
    head: string,
    title: string,
    body: string
  ): Promise<any> {
    return this.githubRequest(
      `POST /repos/${owner}/${repo}/pulls`,
      { base, head, title, body, draft: false }
    );
  }

  // Generic GitHub API request with error handling
  private async githubRequest(endpoint: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const [method, path] = endpoint.split(" ");
      const url = `https://api.github.com${path}`;

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

            // Handle GitHub API error responses
            if (res.statusCode >= 400) {
              const error = new Error(
                json.message || `HTTP ${res.statusCode}`
              );
              (error as any).statusCode = res.statusCode;
              (error as any).response = json;
              reject(error);
              return;
            }

            // Handle rate limiting
            if (res.statusCode === 429) {
              const resetTime = parseInt(res.headers["x-ratelimit-reset"]) * 1000;
              const waitMs = Math.max(0, resetTime - Date.now());
              const error = new Error(
                `Rate limited. Retry after ${Math.ceil(waitMs / 1000)}s`
              );
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

  // Record contribution to database + governance lineage (Phase 24.5)
  private async recordContributionToDB(
    skillId: string,
    skillName: string,
    prResult: any,
    metadata: GitHubContributionMetadata,
    commitSha: string,
    diffSummary: any
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO skill_contributions (
          skill_id, pr_number, pr_url, pr_branch,
          upstream_repo_url, status, contribution_type,
          change_summary, author, created_at, lines_added, lines_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      `;

      const result = await this.db.execute(query, [
        skillId,
        prResult.number,
        prResult.html_url,
        metadata.branch,
        `https://github.com/${metadata.owner}/${metadata.repo}`,
        "open",
        "feature", // Default contribution type for SCP
        `${commitSha.slice(0, 7)}`,
        "scp-bot",
        diffSummary.linesAdded || 0,
        diffSummary.linesDeleted || 0,
      ]);

      log(skillId, "Recorded contribution to database");

      // Record governance event (Phase 24.5 integration)
      try {
        const contrib: SkillContribution = {
          skillId,
          skillName,
          prNumber: prResult.number,
          upstreamRepo: `https://github.com/${metadata.owner}/${metadata.repo}`,
          prUrl: prResult.html_url,
          status: "open",
          createdAt: new Date().toISOString() as ISO8601,
          lastChecked: new Date().toISOString() as ISO8601,
          author: "scp-bot",
          type: "feature",
          description: `${diffSummary.linesAdded} added, ${diffSummary.linesDeleted} deleted`,
        };

        // Record submission event in skill_lineage
        const lineageId = await this.governanceBridge.recordContributionEvent(
          contrib,
          "submitted"
        );
        log(
          skillId,
          `Recorded governance event (lineage #${lineageId}) for PR #${prResult.number}`
        );

        // Link contribution to lineage record
        await this.governanceBridge.linkContributionToLineage(
          skillId,
          prResult.number,
          lineageId
        );
        log(
          skillId,
          `Linked PR #${prResult.number} to skill_lineage #${lineageId}`
        );
      } catch (govError) {
        logError(skillId, "Failed to record governance event", govError);
        // Non-fatal: contribution already recorded, governance linking is best-effort
      }
    } catch (error) {
      logError(skillId, "Failed to record contribution", error);
      // Non-fatal: don't throw, just log
    }
  }

  // Read skill file
  private async readSkillFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  // Utility: sleep
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
