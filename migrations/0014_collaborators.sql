-- Trip collaborators table for shared editing
CREATE TABLE IF NOT EXISTS trip_collaborators (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',  -- 'editor' | 'viewer'
  invited_by TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(trip_id, user_id)
);

-- Invitation tokens for collaborator invites (before user accepts)
CREATE TABLE IF NOT EXISTS collaborator_invites (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',  -- 'editor' | 'viewer'
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,  -- Invite expires after 7 days
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(trip_id, email)
);

-- Active editors tracking (for showing who is currently editing)
CREATE TABLE IF NOT EXISTS active_editors (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(trip_id, user_id)
);

-- Index for fast collaborator lookup
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_trip_id ON trip_collaborators(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user_id ON trip_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_collaborator_invites_token ON collaborator_invites(token);
CREATE INDEX IF NOT EXISTS idx_collaborator_invites_trip_id ON collaborator_invites(trip_id);
CREATE INDEX IF NOT EXISTS idx_active_editors_trip_id ON active_editors(trip_id);
