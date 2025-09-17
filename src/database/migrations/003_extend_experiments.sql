-- Migration 003: Extend experiments for feature flags
-- Description: Add feature flag specific fields to experiments table

-- Add feature flag specific columns to experiments
ALTER TABLE experiments ADD COLUMN kill_switch BOOLEAN DEFAULT FALSE;
ALTER TABLE experiments ADD COLUMN default_variant_id TEXT;
ALTER TABLE experiments ADD COLUMN rollout_percentage REAL DEFAULT 0.0;
ALTER TABLE experiments ADD COLUMN sticky_bucketing BOOLEAN DEFAULT TRUE;

-- Add feature flag columns to variants
ALTER TABLE variants ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
ALTER TABLE variants ADD COLUMN enabled BOOLEAN DEFAULT TRUE;

-- Add assignment tracking columns
ALTER TABLE assignments ADD COLUMN assignment_hash TEXT;
ALTER TABLE assignments ADD COLUMN sticky BOOLEAN DEFAULT TRUE;

-- Add new indexes
CREATE INDEX IF NOT EXISTS idx_assignments_hash ON assignments(assignment_hash);
CREATE INDEX IF NOT EXISTS idx_variants_default ON variants(experiment_id, is_default);
