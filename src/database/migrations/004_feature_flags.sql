-- Migration 004: Feature flags system
-- Description: Add dedicated feature flags tables for advanced flag management

-- Feature flags table (for quick flag resolution)
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  kill_switch BOOLEAN DEFAULT FALSE,
  default_value JSON DEFAULT 'false',
  targeting_rules JSON DEFAULT '[]',
  rollout_percentage REAL DEFAULT 0.0,
  variations JSON DEFAULT '[]',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Flag evaluations table (for tracking flag evaluations)
CREATE TABLE IF NOT EXISTS flag_evaluations (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  variation_key TEXT,
  variation_value JSON,
  reason TEXT, -- 'targeting', 'rollout', 'default', 'kill_switch'
  context JSON DEFAULT '{}',
  evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for feature flags
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(flag_key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled, kill_switch);
CREATE INDEX IF NOT EXISTS idx_flag_evaluations_flag_user ON flag_evaluations(flag_id, user_id);
CREATE INDEX IF NOT EXISTS idx_flag_evaluations_timestamp ON flag_evaluations(evaluated_at);
