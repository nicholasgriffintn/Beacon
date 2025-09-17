-- Migration 002: Add sites table
-- Description: Add sites table for domain validation and access control

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domains JSON NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sites_site_id ON sites(site_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);
