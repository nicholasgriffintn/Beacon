-- Migration 008: Attach experiments to OpenFeature flags
-- Description: Make feature flags canonical and model experiments as allocations within a flag

ALTER TABLE experiments ADD COLUMN flag_key TEXT;

UPDATE experiments
SET flag_key = id
WHERE flag_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_experiments_flag_key ON experiments(flag_key);

INSERT OR IGNORE INTO feature_flags (
  id, flag_key, name, description, enabled, kill_switch,
  default_value, targeting_rules, rollout_percentage, variations,
  created_at, updated_at
) VALUES (
  'flag_color_scheme',
  'color_scheme',
  'Color Scheme',
  'Theme configuration flag used by the colour scheme experiment',
  true,
  false,
  '{}',
  '[]',
  100.0,
  '[
    {
      "key": "color_scheme_control",
      "name": "control",
      "value": {
        "bgColor": "#ffffff",
        "textColor": "#333333",
        "headingColor": "#2563eb",
        "borderColor": "#e5e7eb"
      }
    },
    {
      "key": "color_scheme_dark",
      "name": "dark",
      "value": {
        "bgColor": "#1a1a1a",
        "textColor": "#e5e7eb",
        "headingColor": "#60a5fa",
        "borderColor": "#374151",
        "codeBg": "#2d3748",
        "codeText": "#e2e8f0"
      }
    }
  ]',
  datetime('now'),
  datetime('now')
);
