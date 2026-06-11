// Core types for CIC governance engine

export type ISO8601 = string; // "2026-06-07T12:00:00Z"
export type GovernanceVerdict = "PASS" | "WARN" | "FAIL";

export interface GovernancePolicy {
  id: string;
  description: string;
  severity: "low" | "medium" | "high";
  category: "injection" | "safety" | "completeness" | "scope";
  reaudit_interval_days: number;
  deterministic_check?: {
    type: "regex" | "ast_pattern" | "static_rule";
    patterns: string[];
    always_fail: boolean;
  };
  llm_check?: boolean;
  examples: {
    pass: string[];
    fail: string[];
  };
}

export interface AuditResult {
  // Identity
  skill_id: string;
  skill_name: string;
  skill_version: string;
  source: "AbsolutelySkilled" | "Local" | "Internal";

  // Verdict & Risk
  verdict: GovernanceVerdict;
  policies_triggered: GovernancePolicy[];
  risk_score: number;

  // Flags from deterministic stage
  deterministic_flags: {
    policy_id: string;
    severity: string;
    check_type: string;
    matched_pattern?: string;
  }[];

  // Metadata
  audit_timestamp: ISO8601;
  auditor_model: "deterministic" | "semantic";
  policy_version: string;
  audit_duration_ms: number;

  // Override (if applicable)
  override_decision?: {
    approver_id: string;
    reason: string;
    expires_at: ISO8601;
    linked_approval_record_id?: string;
  };

  notes: string[];
}

export interface GovernanceContext {
  skill_id: string;
  skill_name: string;
  skill_version: string;
  source: "AbsolutelySkilled" | "Local" | "Internal";
  intended_scope: string;
  has_access_to: ("credentials" | "file_system" | "network" | "external_api")[];
  requested_permissions: string[];
  user_tier: "internal" | "external" | "admin";
  task_context?: string;
  is_bulk_operation: boolean;
  force_reaudit: boolean;
}

export interface SkillGovernanceRecord {
  skill_id: string;
  skill_name: string;
  skill_version: string;
  source: string;
  status: "ACTIVE" | "DEPRECATED" | "SUSPENDED" | "REVOKED";
  status_reason?: string;
  current_audit: AuditResult;
  previous_audits: AuditResult[];
  last_audit_at: ISO8601;
  next_mandatory_audit_at: ISO8601;
  execution_count: number;
  execution_success_count: number;
  execution_failure_count: number;
  failure_rate: number;
  average_execution_time_ms: number;
  user_complaints: number;
  user_compliments: number;
  anomaly_flags: {
    type: "high_failure_rate" | "behavioral_drift" | "new_permission_request" | "response_corruption";
    detected_at: ISO8601;
    severity: "warning" | "critical";
    details: string;
  }[];
}

export interface Skill {
  meta: {
    id: string;
    name: string;
    version: string;
    scope?: string;
    permissions?: ("credentials" | "file_system" | "network" | "external_api")[];
    requested_permissions?: string[];
  };
  content: string;
  execute?: (input: unknown) => Promise<unknown>;
}

// ============================================================================
// SCP (Skill Contribution Pipeline) Phase 28a: Manifest Types
// ============================================================================

export interface SkillSourceRepo {
  url: string;
  branch: string;
  remotePath: string;
  lastSyncCommit: string;
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
  id: string;
  name: string;
  localPath: string;
  sourceRepo: SkillSourceRepo;
  available: boolean;
  localModified: boolean;
  modifications?: SkillModification[];
  lastMergedAt?: ISO8601;
}

export interface SkillManifest {
  version: string;
  lastUpdated: ISO8601;
  skills: SkillManifestEntry[];
}

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
  notes?: string;
}

// Database records
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

// ============================================================================
// SCP Phase 28a.3: Change Detection Types
// ============================================================================

export type DiffStatus = "no-change" | "modified" | "error" | "not-found" | "network-fail";

export interface DiffSummary {
  status: DiffStatus;
  linesAdded: number;
  linesDeleted: number;
  linesModified: number;
  percentageChanged: number;
  lastDetectedAt: ISO8601;
  errorMessage?: string;
  retryAttempts?: number;
}

export interface DiffResult {
  skillId: string;
  skillName: string;
  hasChanges: boolean;
  summary: DiffSummary;
  unifiedDiff?: string;
  localChecksum?: string;
  remoteChecksum?: string;
  detectedAt: ISO8601;
}

// ============================================================================
// SCP Phase 28a.4: Contribution Agent Types
// ============================================================================

export interface PRCreationRequest {
  skillId: string;
  skillName: string;
  upstreamRepoUrl: string;
  upstreamBranch: string;
  localFilePath: string;
  diffSummary: DiffSummary;
  commitMessage?: string;
  prTitle?: string;
  prDescription?: string;
}

export interface PRCreationResult {
  skillId: string;
  prNumber: number;
  prUrl: string;
  prBranch: string;
  commitSha: string;
  createdAt: ISO8601;
  status: "open" | "draft";
}

export interface GitHubContributionMetadata {
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  prTitle: string;
  prDescription: string;
}
