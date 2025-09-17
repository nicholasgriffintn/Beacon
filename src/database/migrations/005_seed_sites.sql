-- Migration 005: Seed Polychat sites

INSERT OR IGNORE INTO sites (id, site_id, name, domains, status, created_at, updated_at) VALUES 
(
  'site_beacon_docs',
  'beacon-docs', 
  'Beacon Documentation',
  '["localhost", "beacon.polychat.app"]',
  'active',
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO sites (id, site_id, name, domains, status, created_at, updated_at) VALUES 
(
  'site_polychat',
  'polychat', 
  'Polychat',
  '["polychat.app"]',
  'active',
  datetime('now'),
  datetime('now')
);
