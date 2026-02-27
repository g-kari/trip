-- Expense payments table (who paid for what)
-- This allows standalone expenses not tied to items
CREATE TABLE IF NOT EXISTS standalone_expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  payer_id TEXT NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,   -- amount in JPY
  description TEXT,          -- description for standalone expenses
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Expense participant splits for standalone expenses
CREATE TABLE IF NOT EXISTS standalone_expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES standalone_expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
  share_type TEXT DEFAULT 'equal',  -- 'equal' | 'percentage' | 'amount'
  share_value INTEGER,  -- percentage (0-100) or fixed amount in JPY
  UNIQUE(expense_id, member_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_standalone_expenses_trip_id ON standalone_expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_standalone_expenses_item_id ON standalone_expenses(item_id);
CREATE INDEX IF NOT EXISTS idx_standalone_expenses_payer_id ON standalone_expenses(payer_id);
CREATE INDEX IF NOT EXISTS idx_standalone_expense_splits_expense_id ON standalone_expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_standalone_expense_splits_member_id ON standalone_expense_splits(member_id);
