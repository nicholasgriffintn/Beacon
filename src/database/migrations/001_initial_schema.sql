-- Migration 001: Initial schema
-- Description: Create initial tables for experiments, variants, assignments, and metrics

-- Experiments table
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('ab_test', 'feature_flag', 'holdout')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'completed', 'stopped')),
  targeting_rules JSON DEFAULT '{}',
  traffic_allocation REAL NOT NULL DEFAULT 100.0,
  start_time DATETIME,
  end_time DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  ended_at DATETIME,
  stopped_reason TEXT
);

-- Variants table
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('control', 'treatment', 'feature_flag')),
  config JSON DEFAULT '{}',
  traffic_percentage REAL NOT NULL,
  UNIQUE(experiment_id, name)
);

-- Assignments table (for tracking variant assignments)
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  context JSON DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experiment_id, user_id)
);

-- Metrics table (for defining available metrics)
CREATE TABLE IF NOT EXISTS metrics (
  name TEXT PRIMARY KEY,
  description TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('continuous', 'binary', 'count')),
  aggregation_method TEXT NOT NULL
);

-- Experiment metrics table (junction table)
CREATE TABLE IF NOT EXISTS experiment_metrics (
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL REFERENCES metrics(name) ON DELETE CASCADE,
  PRIMARY KEY (experiment_id, metric_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_experiment_id ON assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_variants_experiment_id ON variants(experiment_id);
