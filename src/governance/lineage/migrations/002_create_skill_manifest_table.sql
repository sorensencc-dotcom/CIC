-- Migration: Create skill_manifest table for SCP (Phase 28a)
-- Tracks adopted skills, source repos, versions, and local modifications

CREATE TABLE IF NOT EXISTS skill_manifest (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,

  -- Skill identity
  skill_id VARCHAR(255) NOT NULL UNIQUE,
  skill_name VARCHAR(255) NOT NULL,
  local_path VARCHAR(512) NOT NULL COMMENT 'e.g. ~/.claude/skills/skill-name.md',

  -- Source repository tracking
  source_repo_url VARCHAR(1024) NOT NULL,
  source_repo_branch VARCHAR(255) DEFAULT 'main',
  source_repo_path VARCHAR(512) NOT NULL COMMENT 'e.g. skills/skill-name.md',
  last_sync_commit VARCHAR(40) NOT NULL COMMENT 'Git commit SHA',

  -- Modification tracking
  is_available BOOLEAN DEFAULT true COMMENT 'false if 404/unavailable',
  is_locally_modified BOOLEAN DEFAULT false,
  modification_count INT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_skill_id (skill_id),
  INDEX idx_is_available (is_available),
  INDEX idx_is_modified (is_locally_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Manifest of adopted skills and source repository tracking for SCP';
