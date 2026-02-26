-- Item templates for quick addition of frequently used items
CREATE TABLE item_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  area TEXT,
  time_start TEXT,
  time_end TEXT,
  map_url TEXT,
  note TEXT,
  cost INTEGER,
  cost_category TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_item_templates_user ON item_templates(user_id);
