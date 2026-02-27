-- Trip templates table
CREATE TABLE IF NOT EXISTS trip_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  theme TEXT NOT NULL DEFAULT 'quiet',
  days_data TEXT NOT NULL, -- JSON: [{day_offset: 0, items: [{title, area, time_start, time_end, cost}]}]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_trip_templates_user_id ON trip_templates(user_id);
