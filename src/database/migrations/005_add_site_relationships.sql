-- Migration 005: Add site relationships to experiments and feature flags
-- Description: Link experiments and feature flags to specific sites

-- Add site_id to experiments table
ALTER TABLE experiments ADD COLUMN site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL;

-- Add site_id to feature_flags table  
ALTER TABLE feature_flags ADD COLUMN site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL;

-- Add indexes for site relationships
CREATE INDEX IF NOT EXISTS idx_experiments_site_id ON experiments(site_id);
CREATE INDEX IF NOT EXISTS idx_feature_flags_site_id ON feature_flags(site_id);
