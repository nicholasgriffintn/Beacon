-- Migration 007: Experiment event mirror
-- Description: Store experiment exposure and conversion events for dashboard result refreshes

CREATE TABLE IF NOT EXISTS experiment_events (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id TEXT,
  variant_name TEXT,
  user_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('exposure', 'conversion', 'event')),
  conversion_id TEXT,
  value REAL DEFAULT 0.0,
  properties JSON DEFAULT '{}',
  occurred_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_experiment_events_experiment_variant ON experiment_events(experiment_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_experiment_events_user ON experiment_events(experiment_id, user_id);
CREATE INDEX IF NOT EXISTS idx_experiment_events_type ON experiment_events(experiment_id, event_type);
CREATE INDEX IF NOT EXISTS idx_experiment_events_occurred_at ON experiment_events(occurred_at);
