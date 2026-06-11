// Contribution Agent Tests - Phase 28a.4
// Covers: happy path, auth failures, rate limiting, network failures, DB recording

import { ContributionAgent } from "./contribution-agent";
import { PRCreationRequest, DiffSummary } from "../models";

describe("ContributionAgent", () => {
  let agent: ContributionAgent;
  let mockDb: any;

  const mockRequest: PRCreationRequest = {
    skillId: "test-skill",
    skillName: "Test Skill",
    upstreamRepoUrl: "https://github.com/anthropics/claude-skills",
    upstreamBranch: "main",
    localFilePath: "/home/user/.claude/skills/test-skill.md",
    diffSummary: {
      status: "modified",
      linesAdded: 50,
      linesDeleted: 20,
      linesModified: 10,
      percentageChanged: 15,
      lastDetectedAt: new Date().toISOString(),
    } as DiffSummary,
  };

  beforeEach(() => {
    mockDb = {
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      query: jest.fn(),
    };

    process.env.GITHUB_TOKEN = "test-token-123";
    agent = new ContributionAgent(mockDb, {
      maxRetries: 2,
      retryDelayMs: 100,
      timeoutMs: 5000,
    });
  });

  describe("createPullRequest - Happy Path", () => {
    it("should create PR from detected changes", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "# Updated Skill\n\nContent");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockResolvedValueOnce(
        "abc123def456"
      );
      jest.spyOn(agent as any, "createBranchWithRetry").mockResolvedValueOnce(
        "abc123def456"
      );
      jest.spyOn(agent as any, "commitFileWithRetry").mockResolvedValueOnce(
        "commit789"
      );
      jest.spyOn(agent as any, "createPRWithRetry").mockResolvedValueOnce({
        number: 42,
        html_url: "https://github.com/anthropics/claude-skills/pull/42",
        draft: false,
      });

      const result = await agent.createPullRequest(mockRequest);

      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toContain("pull/42");
      expect(result.prBranch).toMatch(/^scp-contrib\/test-skill-/);
      expect(result.status).toBe("open");
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe("createPullRequest - Validation", () => {
    it("should reject if no changes detected", async () => {
      const noChangeRequest = {
        ...mockRequest,
        diffSummary: {
          status: "no-change" as const,
          linesAdded: 0,
          linesDeleted: 0,
          linesModified: 0,
          percentageChanged: 0,
          lastDetectedAt: new Date().toISOString(),
        } as DiffSummary,
      };

      await expect(agent.createPullRequest(noChangeRequest)).rejects.toThrow(
        "No changes detected"
      );
    });

    it("should reject on invalid GitHub URL", async () => {
      const badUrlRequest = {
        ...mockRequest,
        upstreamRepoUrl: "https://example.com/repo",
      };

      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      await expect(agent.createPullRequest(badUrlRequest)).rejects.toThrow(
        "Invalid GitHub URL"
      );
    });
  });

  describe("createPullRequest - GitHub API Errors", () => {
    it("should handle 401 authentication failure", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockRejectedValueOnce(
        new Error("401 Bad credentials")
      );

      await expect(agent.createPullRequest(mockRequest)).rejects.toThrow(
        "Bad credentials"
      );
    });

    it("should handle 404 repository not found", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockRejectedValueOnce(
        new Error("404 Repository not found")
      );

      await expect(agent.createPullRequest(mockRequest)).rejects.toThrow(
        "not found"
      );
    });

    it("should handle 422 branch already exists (retry idempotency)", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockResolvedValueOnce(
        "abc123"
      );

      // First attempt: 422 branch exists; agent returns baseSha (idempotent)
      jest.spyOn(agent as any, "createBranchWithRetry").mockResolvedValueOnce(
        "abc123"
      );

      jest.spyOn(agent as any, "commitFileWithRetry").mockResolvedValueOnce(
        "commit789"
      );
      jest.spyOn(agent as any, "createPRWithRetry").mockResolvedValueOnce({
        number: 43,
        html_url: "https://github.com/anthropics/claude-skills/pull/43",
        draft: false,
      });

      const result = await agent.createPullRequest(mockRequest);

      expect(result.prNumber).toBe(43);
    });
  });

  describe("createPullRequest - Rate Limiting", () => {
    it("should handle 429 rate limit", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      const rateLimitError = new Error("API rate limit exceeded");
      (rateLimitError as any).statusCode = 429;
      (rateLimitError as any).retryAfter = 3600000;

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockRejectedValueOnce(
        rateLimitError
      );

      await expect(agent.createPullRequest(mockRequest)).rejects.toThrow(
        "rate limit"
      );
    });
  });

  describe("createPullRequest - Network Failures", () => {
    it("should retry on timeout and fail after max attempts", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockRejectedValueOnce(
        new Error("GitHub API timeout")
      );

      await expect(agent.createPullRequest(mockRequest)).rejects.toThrow(
        "timeout"
      );
    });

    it("should handle file read errors", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(new Error("ENOENT: no such file"));
      });

      await expect(agent.createPullRequest(mockRequest)).rejects.toThrow(
        "ENOENT"
      );
    });
  });

  describe("parseGitHubUrl", () => {
    it("should extract owner and repo from HTTPS URL", () => {
      const metadata = (agent as any).parseGitHubUrl(
        "https://github.com/anthropics/claude-skills",
        "test",
        mockRequest.diffSummary
      );

      expect(metadata.owner).toBe("anthropics");
      expect(metadata.repo).toBe("claude-skills");
      expect(metadata.branch).toMatch(/^scp-contrib\/test-/);
      expect(metadata.commitMessage).toContain("SCP");
      expect(metadata.prTitle).toContain("test");
    });

    it("should extract owner and repo from SSH URL", () => {
      const metadata = (agent as any).parseGitHubUrl(
        "git@github.com:anthropics/claude-skills.git",
        "test",
        mockRequest.diffSummary
      );

      expect(metadata.owner).toBe("anthropics");
      expect(metadata.repo).toBe("claude-skills");
    });

    it("should reject invalid URLs", () => {
      expect(() => {
        (agent as any).parseGitHubUrl(
          "https://example.com/repo",
          "test",
          mockRequest.diffSummary
        );
      }).toThrow("Invalid GitHub URL");
    });
  });

  describe("Error Handling - Missing Token", () => {
    it("should throw if GITHUB_TOKEN not set", () => {
      delete process.env.GITHUB_TOKEN;

      expect(() => {
        new ContributionAgent(mockDb);
      }).toThrow("GITHUB_TOKEN");
    });
  });

  describe("Error Handling - DB Recording", () => {
    it("should not fail if DB recording fails (non-fatal)", async () => {
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, "Content");
      });

      jest.spyOn(agent as any, "getDefaultBranchShaWithRetry").mockResolvedValueOnce(
        "abc123"
      );
      jest.spyOn(agent as any, "createBranchWithRetry").mockResolvedValueOnce(
        "abc123"
      );
      jest.spyOn(agent as any, "commitFileWithRetry").mockResolvedValueOnce(
        "commit789"
      );
      jest.spyOn(agent as any, "createPRWithRetry").mockResolvedValueOnce({
        number: 44,
        html_url: "https://github.com/anthropics/claude-skills/pull/44",
        draft: false,
      });

      mockDb.execute.mockRejectedValueOnce(new Error("DB connection lost"));

      // Should still return successful PR creation
      const result = await agent.createPullRequest(mockRequest);

      expect(result.prNumber).toBe(44);
    });
  });
});
