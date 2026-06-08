-- Migration: Create skill_lineage append-only audit log table

CREATE TABLE IF NOT EXISTS skill_lineage (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  skill_id VARCHAR(255) NOT NULL,
  skill_name VARCHAR(255) NOT NULL,
  skill_version VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL,
  audit_verdict VARCHAR(10) NOT NULL,
  policies_triggered JSON NOT NULL COMMENT 'Array of policy IDs: ["POLICY_ID", ...]',
  risk_score FLOAT NOT NULL,
  audit_timestamp TIMESTAMP NOT NULL,
  auditor_model VARCHAR(50) NOT NULL,
  policy_version VARCHAR(20) NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_skill_id (skill_id),
  INDEX idx_audit_timestamp (audit_timestamp),
  INDEX idx_verdict (audit_verdict),
  INDEX idx_recorded_at (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Immutable append-only audit log for skill governance verdicts';
