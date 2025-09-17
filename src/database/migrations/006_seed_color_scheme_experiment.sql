-- Migration 006: Seed color scheme experiment for ExperimentTester
-- Description: Seeds the color_scheme A/B test with control and dark theme variants

INSERT OR REPLACE INTO experiments (
  id, name, description, type, status, site_id,
  targeting_rules, traffic_allocation,
  start_time, end_time, created_at, updated_at
) VALUES (
  'color_scheme',
  'Color Scheme Test',
  'A/B test comparing light theme (control) vs dark theme for user experience',
  'ab_test',
  'running',
  NULL,
  '{}',
  100.0,
  datetime('now'),
  NULL,
  datetime('now'),
  datetime('now')
);

-- Control variant (light theme)
INSERT OR REPLACE INTO variants (
  id, experiment_id, name, type,
  config, traffic_percentage, is_default, enabled
) VALUES (
  'color_scheme_control',
  'color_scheme',
  'control',
  'control',
  '{
    "bgColor": "#ffffff",
    "textColor": "#333333", 
    "headingColor": "#2563eb",
    "borderColor": "#e5e7eb"
  }',
  50.0,
  true,
  true
);

-- Dark theme variant
INSERT OR REPLACE INTO variants (
  id, experiment_id, name, type,
  config, traffic_percentage, is_default, enabled
) VALUES (
  'color_scheme_dark',
  'color_scheme', 
  'dark',
  'treatment',
  '{
    "bgColor": "#1a1a1a",
    "textColor": "#e5e7eb",
    "headingColor": "#60a5fa", 
    "borderColor": "#374151",
    "codeBg": "#2d3748",
    "codeText": "#e2e8f0"
  }',
  50.0,
  false,
  true
);
