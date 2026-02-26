-- Fix invited_by column to be nullable (required for ON DELETE SET NULL to work)
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the tables

-- Recreate trip_collaborators with nullable invited_by
CREATE TABLE IF NOT EXISTS trip_collaborators_new (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by TEXT,  -- Now nullable to support ON DELETE SET NULL
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(trip_id, user_id)
);

-- Copy data from old table
INSERT INTO trip_collaborators_new (id, trip_id, user_id, role, invited_by, created_at)
SELECT id, trip_id, user_id, role, invited_by, created_at FROM trip_collaborators;

-- Drop old table and rename new one
DROP TABLE IF EXISTS trip_collaborators;
ALTER TABLE trip_collaborators_new RENAME TO trip_collaborators;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_trip_id ON trip_collaborators(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user_id ON trip_collaborators(user_id);

-- Also fix collaborator_invites - change ON DELETE CASCADE to SET NULL for invited_by
CREATE TABLE IF NOT EXISTS collaborator_invites_new (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT,  -- Now nullable
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(trip_id, email)
);

-- Copy data from old table
INSERT INTO collaborator_invites_new (id, trip_id, email, role, token, invited_by, created_at, expires_at)
SELECT id, trip_id, email, role, token, invited_by, created_at, expires_at FROM collaborator_invites;

-- Drop old table and rename new one
DROP TABLE IF EXISTS collaborator_invites;
ALTER TABLE collaborator_invites_new RENAME TO collaborator_invites;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_collaborator_invites_token ON collaborator_invites(token);
CREATE INDEX IF NOT EXISTS idx_collaborator_invites_trip_id ON collaborator_invites(trip_id);
