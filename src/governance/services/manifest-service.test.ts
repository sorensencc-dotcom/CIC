// Manifest Service Tests - Phase 28a.2
// Unit tests for skill registration, listing, and contribution tracking

import { ManifestService } from "./manifest-service";
import { SkillManifestEntry } from "../models";

describe("ManifestService", () => {
  let service: ManifestService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: jest.fn(),
      query: jest.fn(),
    };
    service = new ManifestService(mockDb);
  });

  describe("registerSkill", () => {
    it("should register a new skill", async () => {
      const skill: SkillManifestEntry = {
        id: "test-skill",
        name: "Test Skill",
        localPath: "/home/user/.claude/skills/test-skill.md",
        sourceRepo: {
          url: "https://github.com/anthropics/claude-skills",
          branch: "main",
          remotePath: "skills/test-skill.md",
          lastSyncCommit: "abc123",
        },
        available: true,
        localModified: false,
      };

      mockDb.execute.mockResolvedValue({ insertId: 1 });
      mockDb.query.mockResolvedValue([
        {
          id: 1,
          skill_id: skill.id,
          skill_name: skill.name,
          local_path: skill.localPath,
          source_repo_url: skill.sourceRepo.url,
          source_repo_branch: skill.sourceRepo.branch,
          source_repo_path: skill.sourceRepo.remotePath,
          last_sync_commit: skill.sourceRepo.lastSyncCommit,
          is_available: 1,
          is_locally_modified: 0,
          modification_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      const result = await service.registerSkill(skill);

      expect(mockDb.execute).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.skill_id).toBe(skill.id);
    });
  });

  describe("listSkills", () => {
    it("should list all registered skills", async () => {
      const mockSkills = [
        {
          id: 1,
          skill_id: "skill-1",
          skill_name: "Skill 1",
          is_available: 1,
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          skill_id: "skill-2",
          skill_name: "Skill 2",
          is_available: 1,
          created_at: new Date().toISOString(),
        },
      ];

      mockDb.query.mockResolvedValue(mockSkills);

      const result = await service.listSkills();

      expect(result).toHaveLength(2);
      expect(result[0].skill_id).toBe("skill-1");
    });
  });

  describe("listModifiedSkills", () => {
    it("should list only locally modified skills", async () => {
      const mockSkills = [
        {
          id: 1,
          skill_id: "skill-1",
          is_locally_modified: 1,
          updated_at: new Date().toISOString(),
        },
      ];

      mockDb.query.mockResolvedValue(mockSkills);

      const result = await service.listModifiedSkills();

      expect(result).toHaveLength(1);
      expect(result[0].is_locally_modified).toBe(1);
    });
  });

  describe("recordContribution", () => {
    it("should record a PR contribution", async () => {
      const contrib = {
        id: 0,
        skill_id: "test-skill",
        pr_number: 42,
        pr_url: "https://github.com/anthropics/claude-skills/pull/42",
        pr_branch: "contrib/test-skill-20260611",
        upstream_repo_url: "https://github.com/anthropics/claude-skills",
        status: "open" as const,
        status_updated_at: null,
        contribution_type: "perf-optimization",
        contribution_description: "Optimized performance",
        change_summary: "3x faster processing",
        lines_added: 50,
        lines_deleted: 20,
        author: "skill-pipeline",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_checked_at: null,
        linked_skill_lineage_id: null,
        notes: null,
      };

      mockDb.execute.mockResolvedValue({ insertId: 1 });

      const result = await service.recordContribution(contrib);

      expect(result).toBe(1);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe("updateContributionStatus", () => {
    it("should update PR status to merged", async () => {
      mockDb.execute.mockResolvedValue({ affectedRows: 1 });

      await service.updateContributionStatus(
        "test-skill",
        42,
        "merged",
        "Merged successfully"
      );

      expect(mockDb.execute).toHaveBeenCalled();
      const call = mockDb.execute.mock.calls[0];
      expect(call[1]).toContain("merged");
    });
  });

  describe("markUnavailable", () => {
    it("should mark skill as unavailable after 404", async () => {
      mockDb.execute.mockResolvedValue({ affectedRows: 1 });

      await service.markUnavailable("test-skill", "Repository not found");

      expect(mockDb.execute).toHaveBeenCalled();
      const call = mockDb.execute.mock.calls[0];
      expect(call[0]).toContain("is_available = 0");
    });
  });

  describe("Error Handling - registerSkill", () => {
    it("should propagate database constraint violations", async () => {
      const skill: SkillManifestEntry = {
        id: "duplicate",
        name: "Duplicate Skill",
        localPath: "/home/user/.claude/skills/duplicate.md",
        sourceRepo: {
          url: "https://github.com/anthropics/claude-skills",
          branch: "main",
          remotePath: "skills/duplicate.md",
          lastSyncCommit: "abc123",
        },
        available: true,
        localModified: false,
      };

      const dbError = new Error("Duplicate entry for key skill_id");
      mockDb.execute.mockRejectedValueOnce(dbError);

      await expect(service.registerSkill(skill)).rejects.toThrow(
        "Duplicate entry"
      );
    });
  });

  describe("Error Handling - getSkillById", () => {
    it("should return null when skill not found", async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.getSkillById("nonexistent");

      expect(result).toBeNull();
    });

    it("should propagate database query errors", async () => {
      mockDb.query.mockRejectedValueOnce(new Error("Connection timeout"));

      await expect(service.getSkillById("test-skill")).rejects.toThrow(
        "Connection timeout"
      );
    });
  });

  describe("Error Handling - recordContribution", () => {
    it("should propagate foreign key constraint errors", async () => {
      const contrib = {
        id: 0,
        skill_id: "orphaned",
        pr_number: 42,
        pr_url: "https://github.com/anthropics/claude-skills/pull/42",
        pr_branch: "contrib/orphaned",
        upstream_repo_url: "https://github.com/anthropics/claude-skills",
        status: "open" as const,
        status_updated_at: null,
        contribution_type: "feature" as const,
        contribution_description: "Feature",
        change_summary: "Added feature",
        lines_added: 100,
        lines_deleted: 50,
        author: "bot",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_checked_at: null,
        linked_skill_lineage_id: null,
        notes: null,
      };

      mockDb.execute.mockRejectedValueOnce(
        new Error("Foreign key constraint failed")
      );

      await expect(service.recordContribution(contrib)).rejects.toThrow(
        "Foreign key"
      );
    });
  });

  describe("Error Handling - updateContributionStatus", () => {
    it("should handle database errors during status update", async () => {
      mockDb.execute.mockRejectedValueOnce(new Error("DB locked"));

      await expect(
        service.updateContributionStatus("test", 42, "merged", "Note")
      ).rejects.toThrow("DB locked");
    });
  });

  describe("Error Handling - markUnavailable", () => {
    it("should propagate database errors", async () => {
      mockDb.execute.mockRejectedValueOnce(new Error("Connection lost"));

      await expect(service.markUnavailable("test", "404")).rejects.toThrow(
        "Connection lost"
      );
    });
  });
});
