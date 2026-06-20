// Status Tracker Tests - Phase 28a.5
// Covers: status polling, review state detection, caching, batch operations

import { StatusTracker } from "./status-tracker";
import { PRStatusSnapshot } from "../models";

describe("StatusTracker", () => {
  let tracker: StatusTracker;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      query: jest.fn(),
    };

    process.env.GITHUB_TOKEN = "test-token-456";
    tracker = new StatusTracker(mockDb, {
      maxRetries: 2,
      retryDelayMs: 100,
      timeoutMs: 5000,
      cacheMinutes: 5,
    });
  });

  describe("checkPRStatus - Happy Path", () => {
    it("should fetch PR status and review state", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 42,
        state: "open",
        merged: false,
        review_comments: 3,
        head: { sha: "abc123def456" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce(
        "approved"
      );

      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce({
        state: "success",
      });

      const result = await tracker.checkPRStatus(
        "test-skill",
        42,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.prNumber).toBe(42);
      expect(result.status).toBe("open");
      expect(result.reviewState).toBe("approved");
      expect(result.reviewComments).toBe(3);
      expect(result.commitStatus).toBe("success");
    });

    it("should detect merged status", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 43,
        state: "closed",
        merged: true,
        review_comments: 0,
        head: { sha: "xyz789" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce("none");
      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      const result = await tracker.checkPRStatus(
        "test-skill",
        43,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.status).toBe("merged");
    });
  });

  describe("checkPRStatus - Caching", () => {
    it("should return cached result within 5 minutes", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 44,
        state: "open",
        merged: false,
        review_comments: 1,
        head: { sha: "abc123" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce("pending");
      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      // First call
      const result1 = await tracker.checkPRStatus(
        "test-skill",
        44,
        "https://github.com/anthropics/claude-skills"
      );

      // Clear mocks
      jest.clearAllMocks();

      // Second call (should use cache)
      const result2 = await tracker.checkPRStatus(
        "test-skill",
        44,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result2).toEqual(result1);
      expect(jest.spyOn(tracker as any, "getPRWithRetry")).not.toHaveBeenCalled();
    });

    it("should bypass cache with clearCache()", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 45,
        state: "open",
        merged: false,
        review_comments: 0,
        head: { sha: "def789" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce("none");
      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      // First call
      await tracker.checkPRStatus(
        "test-skill",
        45,
        "https://github.com/anthropics/claude-skills"
      );

      // Clear cache
      tracker.clearCache();

      // Mocks should be called again
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 45,
        state: "closed",
        merged: true,
        review_comments: 0,
        head: { sha: "def789" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce("none");
      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      // Second call (should not use cache)
      const result = await tracker.checkPRStatus(
        "test-skill",
        45,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.status).toBe("merged");
    });
  });

  describe("checkPRStatus - Review States", () => {
    it("should detect approved review state", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 46,
        state: "open",
        merged: false,
        review_comments: 0,
        head: { sha: "abc123" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce(
        "approved"
      );

      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      tracker.clearCache();
      const result = await tracker.checkPRStatus(
        "test-skill",
        46,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.reviewState).toBe("approved");
    });

    it("should detect changes-requested review state", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockResolvedValueOnce({
        number: 47,
        state: "open",
        merged: false,
        review_comments: 2,
        head: { sha: "xyz789" },
      });

      jest.spyOn(tracker as any, "getReviewStateWithRetry").mockResolvedValueOnce(
        "changes-requested"
      );

      jest.spyOn(tracker as any, "getCommitStatusWithRetry").mockResolvedValueOnce(null);

      tracker.clearCache();
      const result = await tracker.checkPRStatus(
        "test-skill",
        47,
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.reviewState).toBe("changes-requested");
    });
  });

  describe("checkPRStatus - Error Handling", () => {
    it("should handle 404 PR not found", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockRejectedValueOnce(
        new Error("404 Not Found")
      );

      await expect(
        tracker.checkPRStatus(
          "test-skill",
          999,
          "https://github.com/anthropics/claude-skills"
        )
      ).rejects.toThrow(/not found|Not Found/i);
    });

    it("should handle 401 unauthorized", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockRejectedValueOnce(
        new Error("401 Bad credentials")
      );

      await expect(
        tracker.checkPRStatus(
          "test-skill",
          42,
          "https://github.com/anthropics/claude-skills"
        )
      ).rejects.toThrow("credentials");
    });

    it("should handle network timeout with retry", async () => {
      jest.spyOn(tracker as any, "getPRWithRetry").mockRejectedValueOnce(
        new Error("GitHub API timeout")
      );

      await expect(
        tracker.checkPRStatus(
          "test-skill",
          42,
          "https://github.com/anthropics/claude-skills"
        )
      ).rejects.toThrow("timeout");
    });
  });

  describe("checkAllPRsForSkill - Batch Operations", () => {
    it("should check all open PRs for a skill", async () => {
      const skillRecord = {
        skill_id: "batch-skill",
        skill_name: "Batch Skill",
        source_repo_url: "https://github.com/anthropics/claude-skills",
      };

      const contributions = [
        {
          skill_id: "batch-skill",
          pr_number: 50,
          upstream_repo_url: "https://github.com/anthropics/claude-skills",
          status: "open",
        },
        {
          skill_id: "batch-skill",
          pr_number: 51,
          upstream_repo_url: "https://github.com/anthropics/claude-skills",
          status: "open",
        },
      ];

      mockDb.query.mockResolvedValueOnce([skillRecord]); // getSkillRecord
      mockDb.query.mockResolvedValueOnce(contributions); // getOpenContributions

      jest.spyOn(tracker as any, "checkPRStatus")
        .mockResolvedValueOnce({
          prNumber: 50,
          status: "open",
          reviewState: "approved",
          reviewComments: 0,
          lastCheckedAt: new Date().toISOString(),
          checkedCount: 1,
        })
        .mockResolvedValueOnce({
          prNumber: 51,
          status: "merged",
          reviewState: "none",
          reviewComments: 0,
          lastCheckedAt: new Date().toISOString(),
          checkedCount: 1,
        });

      const results = await tracker.checkAllPRsForSkill("batch-skill");

      expect(results).toHaveLength(2);
      expect(results[0].prNumber).toBe(50);
      expect(results[1].prNumber).toBe(51);
      expect(results[1].status).toBe("merged");
    });

    it("should handle skill not found in batch", async () => {
      mockDb.query.mockResolvedValueOnce([]); // getSkillRecord

      await expect(tracker.checkAllPRsForSkill("nonexistent")).rejects.toThrow(
        "not found"
      );
    });

    it("should continue checking other PRs on failure", async () => {
      const skillRecord = {
        skill_id: "resilient-skill",
        skill_name: "Resilient Skill",
      };

      const contributions = [
        {
          skill_id: "resilient-skill",
          pr_number: 60,
          upstream_repo_url: "https://github.com/anthropics/claude-skills",
          status: "open",
        },
        {
          skill_id: "resilient-skill",
          pr_number: 61,
          upstream_repo_url: "https://github.com/anthropics/claude-skills",
          status: "open",
        },
      ];

      mockDb.query.mockResolvedValueOnce([skillRecord]); // getSkillRecord
      mockDb.query.mockResolvedValueOnce(contributions); // getOpenContributions

      // First PR fails, second succeeds
      jest.spyOn(tracker as any, "checkPRStatus")
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          prNumber: 61,
          status: "open",
          reviewState: "none",
          reviewComments: 0,
          lastCheckedAt: new Date().toISOString(),
          checkedCount: 1,
        });

      const results = await tracker.checkAllPRsForSkill("resilient-skill");

      // Should return only successful check
      expect(results).toHaveLength(1);
      expect(results[0].prNumber).toBe(61);
    });
  });

  describe("parseRepoUrl", () => {
    it("should parse HTTPS GitHub URLs", () => {
      const result = (tracker as any).parseRepoUrl(
        "https://github.com/anthropics/claude-skills"
      );

      expect(result.owner).toBe("anthropics");
      expect(result.repo).toBe("claude-skills");
    });

    it("should parse SSH GitHub URLs", () => {
      const result = (tracker as any).parseRepoUrl(
        "git@github.com:anthropics/claude-skills.git"
      );

      expect(result.owner).toBe("anthropics");
      expect(result.repo).toBe("claude-skills");
    });

    it("should reject invalid URLs", () => {
      expect(() => {
        (tracker as any).parseRepoUrl("https://example.com/repo");
      }).toThrow("Invalid GitHub URL");
    });
  });

  describe("Error Handling - Missing Token", () => {
    it("should throw if GITHUB_TOKEN not set", () => {
      delete process.env.GITHUB_TOKEN;

      expect(() => {
        new StatusTracker(mockDb);
      }).toThrow("GITHUB_TOKEN");
    });
  });

  describe("checkAndUpdatePRStatus - Governance Integration (Phase 24.5)", () => {
    it("should record governance event when PR merged", async () => {
      // Mock database queries
      mockDb.query.mockResolvedValueOnce([{ status: "open" }]); // Get previous status

      jest.spyOn(tracker as any, "checkPRStatus").mockResolvedValueOnce({
        prNumber: 42,
        status: "merged",
        reviewState: "approved",
        reviewComments: 1,
        commitStatus: "success",
        lastCheckedAt: new Date().toISOString(),
        checkedCount: 1,
      });

      const governanceSpy = jest.spyOn(
        (tracker as any).governanceBridge,
        "recordContributionEvent"
      );
      governanceSpy.mockResolvedValueOnce(100); // Mock lineageId

      const result = await tracker.checkAndUpdatePRStatus(
        "test-skill",
        42,
        "https://github.com/anthropics/claude-skills",
        "Test Skill"
      );

      expect(result.status).toBe("merged");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE skill_contributions SET status"),
        ["merged", "test-skill", 42]
      );
      expect(governanceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: "test-skill",
          prNumber: 42,
          status: "merged",
        }),
        "merged"
      );
    });

    it("should record governance event when PR closed", async () => {
      mockDb.query.mockResolvedValueOnce([{ status: "open" }]);

      jest.spyOn(tracker as any, "checkPRStatus").mockResolvedValueOnce({
        prNumber: 42,
        status: "closed",
        reviewState: "pending",
        reviewComments: 0,
        commitStatus: "failure",
        lastCheckedAt: new Date().toISOString(),
        checkedCount: 1,
      });

      const governanceSpy = jest.spyOn(
        (tracker as any).governanceBridge,
        "recordContributionEvent"
      );
      governanceSpy.mockResolvedValueOnce(101);

      const linkSpy = jest.spyOn(
        (tracker as any).governanceBridge,
        "linkContributionToLineage"
      );
      linkSpy.mockResolvedValueOnce(undefined);

      const result = await tracker.checkAndUpdatePRStatus(
        "test-skill",
        42,
        "https://github.com/anthropics/claude-skills",
        "Test Skill"
      );

      expect(result.status).toBe("closed");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE skill_contributions SET status"),
        ["closed", "test-skill", 42]
      );
      expect(governanceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "closed" }),
        "closed"
      );
    });

    it("should handle governance event recording failures gracefully", async () => {
      mockDb.query.mockResolvedValueOnce([{ status: "open" }]);

      jest.spyOn(tracker as any, "checkPRStatus").mockResolvedValueOnce({
        prNumber: 42,
        status: "merged",
        reviewState: "approved",
        reviewComments: 1,
        commitStatus: "success",
        lastCheckedAt: new Date().toISOString(),
        checkedCount: 1,
      });

      const governanceSpy = jest.spyOn(
        (tracker as any).governanceBridge,
        "recordContributionEvent"
      );
      governanceSpy.mockRejectedValueOnce(new Error("Governance error"));

      const result = await tracker.checkAndUpdatePRStatus(
        "test-skill",
        42,
        "https://github.com/anthropics/claude-skills",
        "Test Skill"
      );

      // Status should still be updated even if governance fails
      expect(result.status).toBe("merged");
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("should not trigger governance events for status changes other than merged/closed", async () => {
      mockDb.query.mockResolvedValueOnce([{ status: "draft" }]);

      jest.spyOn(tracker as any, "checkPRStatus").mockResolvedValueOnce({
        prNumber: 42,
        status: "open",
        reviewState: "pending",
        reviewComments: 0,
        commitStatus: "pending",
        lastCheckedAt: new Date().toISOString(),
        checkedCount: 1,
      });

      const governanceSpy = jest.spyOn(
        (tracker as any).governanceBridge,
        "recordContributionEvent"
      );

      const result = await tracker.checkAndUpdatePRStatus(
        "test-skill",
        42,
        "https://github.com/anthropics/claude-skills",
        "Test Skill"
      );

      expect(result.status).toBe("open");
      // Governance event should NOT be called for draft → open
      expect(governanceSpy).not.toHaveBeenCalled();
    });
  });
});
