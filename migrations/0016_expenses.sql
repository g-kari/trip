-- Trip members table for expense tracking
CREATE TABLE IF NOT EXISTS trip_members (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT,  -- NULL for guest members
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Expense payments table - who paid for each item
CREATE TABLE IF NOT EXISTS expense_payments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  paid_by TEXT NOT NULL,  -- trip_members.id
  amount INTEGER NOT NULL,  -- amount in JPY
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by) REFERENCES trip_members(id) ON DELETE CASCADE
);

-- Expense splits table - how each expense is split among members
CREATE TABLE IF NOT EXISTS expense_splits (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  member_id TEXT NOT NULL,  -- trip_members.id
  share_type TEXT DEFAULT 'equal',  -- 'equal' | 'percentage' | 'amount'
  share_value INTEGER,  -- percentage (0-100) or fixed amount in JPY
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES trip_members(id) ON DELETE CASCADE,
  UNIQUE(item_id, member_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_trip_members_trip_id ON trip_members(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_members_user_id ON trip_members(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_item_id ON expense_payments(item_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_paid_by ON expense_payments(paid_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_item_id ON expense_splits(item_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_member_id ON expense_splits(member_id);
