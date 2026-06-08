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
