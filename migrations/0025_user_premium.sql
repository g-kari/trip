-- Add premium flag to users (true if user has ever purchased trip slots)
-- Once a user pays, they become premium forever (no ads)
ALTER TABLE users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0;

-- Track purchase history for audit
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,           -- Amount in JPY
  trip_slots INTEGER NOT NULL,       -- Number of trip slots purchased
  payment_method TEXT,               -- 'stripe', 'paypay', etc.
  payment_id TEXT,                   -- External payment ID for reference
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);

-- Track trip slot usage
-- free_slots: number of remaining free slots (default 3)
-- purchased_slots: total slots ever purchased
ALTER TABLE users ADD COLUMN free_slots INTEGER NOT NULL DEFAULT 3;
ALTER TABLE users ADD COLUMN purchased_slots INTEGER NOT NULL DEFAULT 0;
