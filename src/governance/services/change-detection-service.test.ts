// Change Detection Service Tests - Phase 28a.3
// Covers: no-change, modified, network failures, missing files, error scenarios

import { ChangeDetectionService } from "./change-detection-service";
import { DiffStatus } from "../models";

describe("ChangeDetectionService", () => {
  let service: ChangeDetectionService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      query: jest.fn(),
    };
    service = new ChangeDetectionService(mockDb, {
      maxRetries: 2,
      retryDelayMs: 100,
      timeoutMs: 5000,
    });
  });

  describe("detectChanges - No Change", () => {
    it("should detect no changes when local and remote are identical", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/home/user/.claude/skills/test-skill.md",
        source_repo_url: "https://github.com/anthropics/claude-skills",
        source_repo_branch: "main",
        source_repo_path: "skills/test-skill.md",
        is_locally_modified: false,
      };

      const content = "# Test Skill\n\nVersion 1.0";

      mockDb.query.mockResolvedValueOnce([skillRecord]);

      // Mock file read
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path: any, enc: any, cb: any) => {
        cb(null, content);
      });

      // Mock remote fetch
      jest.spyOn(service as any, "fetchRemoteWithRetry").mockResolvedValueOnce(content);

      const result = await service.detectChanges("test-skill");

      expect(result.hasChanges).toBe(false);
      expect(result.summary.status).toBe("no-change");
      expect(result.summary.linesAdded).toBe(0);
      expect(result.summary.linesDeleted).toBe(0);
      expect(result.localChecksum).toBe(result.remoteChecksum);
    });
  });

  describe("detectChanges - Modified", () => {
    it("should detect changes when local differs from remote", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/home/user/.claude/skills/test-skill.md",
        source_repo_url: "https://github.com/anthropics/claude-skills",
        source_repo_branch: "main",
        source_repo_path: "skills/test-skill.md",
      };

      const localContent = "# Test Skill\n\nVersion 1.0\n\nLocal addition";
      const remoteContent = "# Test Skill\n\nVersion 1.0";

      mockDb.query.mockResolvedValueOnce([skillRecord]);

      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, localContent);
      });

      jest.spyOn(service as any, "fetchRemoteWithRetry").mockResolvedValueOnce(remoteContent);

      const result = await service.detectChanges("test-skill");

      expect(result.hasChanges).toBe(true);
      expect(result.summary.status).toBe("modified");
      expect(result.summary.linesAdded).toBeGreaterThan(0);
      expect(result.summary.percentageChanged).toBeGreaterThan(0);
    });
  });

  describe("detectChanges - Not Found", () => {
    it("should handle missing skill in manifest", async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.detectChanges("nonexistent");

      expect(result.summary.status).toBe("not-found");
      expect(result.hasChanges).toBe(false);
      expect(result.summary.errorMessage).toContain("not registered");
    });
  });

  describe("detectChanges - Local File Missing", () => {
    it("should handle missing local skill file", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/nonexistent/path/test-skill.md",
      };

      mockDb.query.mockResolvedValueOnce([skillRecord]);
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(false);

      const result = await service.detectChanges("test-skill");

      expect(result.summary.status).toBe("not-found");
      expect(result.summary.errorMessage).toContain("Local file not found");
    });
  });

  describe("detectChanges - Network Failure", () => {
    it("should handle network failure with offline fallback", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/home/user/.claude/skills/test-skill.md",
        source_repo_url: "https://github.com/anthropics/claude-skills",
        source_repo_branch: "main",
        source_repo_path: "skills/test-skill.md",
      };

      const localContent = "# Test Skill";

      mockDb.query.mockResolvedValueOnce([skillRecord]);
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, localContent);
      });

      // Simulate network failure (returns null after retries)
      jest.spyOn(service as any, "fetchRemoteWithRetry").mockResolvedValueOnce(null);

      const result = await service.detectChanges("test-skill");

      expect(result.summary.status).toBe("network-fail");
      expect(result.summary.errorMessage).toContain("Could not reach upstream");
      expect(result.summary.retryAttempts).toBe(2);
    });
  });

  describe("detectChanges - Checksum Validation", () => {
    it("should compute identical checksums for same content", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/home/user/.claude/skills/test-skill.md",
        source_repo_url: "https://github.com/anthropics/claude-skills",
        source_repo_branch: "main",
        source_repo_path: "skills/test-skill.md",
      };

      const content = "# Skill\n\nContent";

      mockDb.query.mockResolvedValueOnce([skillRecord]);
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path: any, enc: any, cb: any) => {
        cb(null, content);
      });

      jest.spyOn(service as any, "fetchRemoteWithRetry").mockResolvedValueOnce(content);

      const result = await service.detectChanges("test-skill");

      expect(result.localChecksum).toBe(result.remoteChecksum);
      expect(result.summary.status).toBe("no-change");
    });

    it("should compute different checksums for different content", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/home/user/.claude/skills/test-skill.md",
        source_repo_url: "https://github.com/anthropics/claude-skills",
        source_repo_branch: "main",
        source_repo_path: "skills/test-skill.md",
      };

      const localContent = "Version A";
      const remoteContent = "Version B";

      mockDb.query.mockResolvedValueOnce([skillRecord]);
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(null, localContent);
      });

      jest.spyOn(service as any, "fetchRemoteWithRetry").mockResolvedValueOnce(remoteContent);

      const result = await service.detectChanges("test-skill");

      expect(result.localChecksum).not.toBe(result.remoteChecksum);
      expect(result.summary.status).toBe("modified");
    });
  });

  describe("buildGithubRawUrl", () => {
    it("should convert GitHub HTTPS URL to raw.githubusercontent", () => {
      const url = "https://github.com/anthropics/claude-skills";
      const branch = "main";
      const path = "skills/test.md";

      const rawUrl = (service as any).buildGithubRawUrl(url, branch, path);

      expect(rawUrl).toBe(
        "https://raw.githubusercontent.com/anthropics/claude-skills/main/skills/test.md"
      );
    });

    it("should handle SSH-style git URLs", () => {
      const url = "git@github.com:anthropics/claude-skills.git";
      // Note: current implementation only handles https
      // This test documents the limitation
      expect(() => {
        (service as any).buildGithubRawUrl(url, "main", "skills/test.md");
      }).toThrow();
    });
  });

  describe("queryModifiedSkills", () => {
    it("should list all locally modified skills", async () => {
      const modified = [
        {
          skill_id: "skill-1",
          is_locally_modified: 1,
          updated_at: new Date().toISOString(),
        },
        {
          skill_id: "skill-2",
          is_locally_modified: 1,
          updated_at: new Date().toISOString(),
        },
      ];

      mockDb.query.mockResolvedValueOnce(modified);

      const result = await service.queryModifiedSkills();

      expect(result).toHaveLength(2);
      expect(result[0].skill_id).toBe("skill-1");
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("is_locally_modified = 1"),
        undefined
      );
    });
  });

  describe("clearModificationFlag", () => {
    it("should clear modification flag after PR submission", async () => {
      mockDb.execute.mockResolvedValueOnce({ affectedRows: 1 });

      await service.clearModificationFlag("test-skill");

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("is_locally_modified = 0"),
        ["test-skill"]
      );
    });
  });

  describe("Error Handling - DB Failures", () => {
    it("should handle DB connection errors gracefully", async () => {
      mockDb.query.mockRejectedValueOnce(new Error("DB connection lost"));

      const result = await service.detectChanges("test-skill");

      expect(result.summary.status).toBe("error");
      expect(result.summary.errorMessage).toContain("DB connection");
    });
  });

  describe("Error Handling - File Read Errors", () => {
    it("should handle file read permission errors", async () => {
      const skillRecord = {
        skill_id: "test-skill",
        skill_name: "Test Skill",
        local_path: "/root/.claude/skills/test-skill.md",
      };

      mockDb.query.mockResolvedValueOnce([skillRecord]);
      jest.spyOn(require("fs"), "existsSync").mockReturnValue(true);
      jest.spyOn(require("fs"), "readFile").mockImplementation((path, enc, cb) => {
        cb(new Error("EACCES: permission denied"));
      });

      const result = await service.detectChanges("test-skill");

      expect(result.summary.status).toBe("error");
      expect(result.summary.errorMessage).toContain("permission");
    });
  });
});
