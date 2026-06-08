export interface AuditConfig {
  // Cache settings
  cache_ttl_days: number;
  cache_enabled: boolean;

  // Deterministic stage
  deterministic_timeout_ms: number;

  // Semantic stage (Phase 2, but define now)
  semantic_audit_profiles: {
    fast: string;
    strict: string;
  };
  semantic_audit_timeout_ms: number;

  // Re-audit scheduling
  default_reaudit_interval_days: number;
  critical_reaudit_interval_days: number;

  // Policy versioning
  policy_version: string;
}

export function loadAuditConfig(): AuditConfig {
  return {
    cache_ttl_days: parseInt(process.env.AUDIT_CACHE_TTL_DAYS || "7", 10),
    cache_enabled: process.env.AUDIT_CACHE_ENABLED !== "false",
    deterministic_timeout_ms: 1000,
    semantic_audit_profiles: {
      fast: process.env.SEMANTIC_AUDIT_MODEL_FAST || "claude-haiku-4-5",
      strict: process.env.SEMANTIC_AUDIT_MODEL_STRICT || "claude-opus-4-8",
    },
    semantic_audit_timeout_ms: 30000,
    default_reaudit_interval_days: 90,
    critical_reaudit_interval_days: 30,
    policy_version: "2.0",
  };
}

export function getDefaultAuditConfig(): AuditConfig {
  return {
    cache_ttl_days: 7,
    cache_enabled: true,
    deterministic_timeout_ms: 1000,
    semantic_audit_profiles: {
      fast: "claude-haiku-4-5",
      strict: "claude-opus-4-8",
    },
    semantic_audit_timeout_ms: 30000,
    default_reaudit_interval_days: 90,
    critical_reaudit_interval_days: 30,
    policy_version: "2.0",
  };
}
