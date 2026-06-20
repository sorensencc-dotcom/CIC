-- Migration: Create skill_contributions table for SCP PR tracking (Phase 28a)
-- Tracks submitted PRs, acceptance/rejection status, and contribution metadata

CREATE TABLE IF NOT EXISTS skill_contributions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,

  -- PR identity
  skill_id VARCHAR(255) NOT NULL,
  pr_number INT NOT NULL,
  pr_url VARCHAR(1024) NOT NULL,
  pr_branch VARCHAR(255) NOT NULL,

  -- Repository tracking
  upstream_repo_url VARCHAR(1024) NOT NULL,

  -- Status & decision
  status VARCHAR(50) NOT NULL DEFAULT 'open' COMMENT 'open|merged|closed|rejected',
  status_updated_at TIMESTAMP,

  -- Contribution metadata
  contribution_type VARCHAR(50) NOT NULL COMMENT 'perf-optimization|bug-fix|feature|test-coverage|error-handling',
  contribution_description TEXT,
  change_summary TEXT COMMENT 'Brief description of changes',
  lines_added INT,
  lines_deleted INT,

  -- Tracking
  author VARCHAR(255) NOT NULL DEFAULT 'skill-pipeline',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_checked_at TIMESTAMP,

  -- Governance linkage
  linked_skill_lineage_id BIGINT COMMENT 'FK to skill_lineage for audit trail',
  notes TEXT COMMENT 'Closure reason, maintainer feedback, etc.',

  UNIQUE KEY unique_pr (skill_id, pr_number),
  INDEX idx_skill_id (skill_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (linked_skill_lineage_id) REFERENCES skill_lineage(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Skill contribution PRs submitted upstream for SCP workflow';
