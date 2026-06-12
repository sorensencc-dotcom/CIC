// SCP (Skill Contribution Pipeline) Manifest Types
// Phase 28a: Manifest schema + CLI for adopted skills

export type ISO8601 = string; // "2026-06-11T00:00:00Z"

export interface SkillSourceRepo {
  url: string; // GitHub repo URL
  branch: string; // "main" or other branch
  remotePath: string; // e.g. "skills/skill-name.md"
  lastSyncCommit: string; // Git SHA
}

export interface SkillModification {
  type: "perf-optimization" | "bug-fix" | "feature" | "test-coverage" | "error-handling";
  description: string;
  dateModified: ISO8601;
  prNumber?: number;
  prUrl?: string;
  prStatus?: "open" | "merged" | "closed";
}

export interface SkillManifestEntry {
  id: string; // Unique skill ID (e.g. "fewer-permission-prompts")
  name: string; // Human readable name
  localPath: string; // ~/.claude/skills/{id}.md
  sourceRepo: SkillSourceRepo;
  available: boolean; // false if 404/unreachable
  localModified: boolean; // true if local changes detected
  modifications?: SkillModification[];
  lastMergedAt?: ISO8601;
}

export interface SkillManifest {
  version: string; // "1.0"
  lastUpdated: ISO8601;
  skills: SkillManifestEntry[];
}

// Contribution tracking
export type ContributionStatus = "open" | "merged" | "closed" | "rejected";

export interface SkillContribution {
  skillId: string;
  skillName: string;
  prNumber: number;
  upstreamRepo: string;
  prUrl: string;
  status: ContributionStatus;
  createdAt: ISO8601;
  lastChecked: ISO8601;
  author: string;
  type: "perf-optimization" | "bug-fix" | "feature" | "test-coverage" | "error-handling";
  description: string;
  notes?: string; // Closure reason, maintainer feedback
}

// Database models
export interface SkillManifestRecord {
  id: number;
  skill_id: string;
  skill_name: string;
  local_path: string;
  source_repo_url: string;
  source_repo_branch: string;
  source_repo_path: string;
  last_sync_commit: string;
  is_available: boolean;
  is_locally_modified: boolean;
  modification_count: number;
  created_at: ISO8601;
  updated_at: ISO8601;
}

export interface SkillContributionRecord {
  id: number;
  skill_id: string;
  pr_number: number;
  pr_url: string;
  pr_branch: string;
  upstream_repo_url: string;
  status: ContributionStatus;
  status_updated_at: ISO8601 | null;
  contribution_type: string;
  contribution_description: string | null;
  change_summary: string | null;
  lines_added: number | null;
  lines_deleted: number | null;
  author: string;
  created_at: ISO8601;
  updated_at: ISO8601;
  last_checked_at: ISO8601 | null;
  linked_skill_lineage_id: number | null;
  notes: string | null;
}
