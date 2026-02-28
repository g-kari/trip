-- Remove UNIQUE(trip_id, email) constraint that blocks multiple invites per trip
CREATE TABLE IF NOT EXISTS collaborator_invites_new (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'editor',
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO collaborator_invites_new SELECT * FROM collaborator_invites;
DROP TABLE collaborator_invites;
ALTER TABLE collaborator_invites_new RENAME TO collaborator_invites;
