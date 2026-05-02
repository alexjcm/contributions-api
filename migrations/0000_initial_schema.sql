PRAGMA foreign_keys=ON;

CREATE TABLE contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
  auth0_sync_status TEXT NOT NULL DEFAULT 'not_linked' CHECK (auth0_sync_status IN ('unknown_legacy', 'not_linked', 'pending_password', 'linked', 'no_access', 'error')),
  auth0_user_id TEXT,
  auth0_last_sync_at TEXT,
  auth0_last_error TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX contributors_email_unique_non_null
ON contributors(email) WHERE email IS NOT NULL;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);

CREATE TABLE contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contributor_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 1),
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (contributor_id) REFERENCES contributors(id)
);

CREATE UNIQUE INDEX contributions_active_unique_idx
ON contributions(contributor_id, year, month) WHERE status = 1;

CREATE INDEX contributions_lookup_idx
ON contributions(year, contributor_id);

INSERT INTO settings (key, value, created_at, created_by, updated_at, updated_by)
VALUES (
  'auth0_auto_sync_enabled',
  'false',
  datetime('now'),
  'system:migration',
  datetime('now'),
  'system:migration'
)
ON CONFLICT(key) DO NOTHING;
