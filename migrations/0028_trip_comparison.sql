-- Comparison groups for comparing multiple trips
CREATE TABLE IF NOT EXISTS comparison_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Trips included in comparison groups
CREATE TABLE IF NOT EXISTS comparison_trips (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  label TEXT,  -- 'プランA', '観光重視' etc.
  sort INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES comparison_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comparison_groups_user ON comparison_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_comparison_trips_group ON comparison_trips(group_id);
