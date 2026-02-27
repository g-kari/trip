-- AI Credit System: monthly credits instead of daily rate limits
ALTER TABLE users ADD COLUMN ai_credits INTEGER NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN credits_reset_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z';

-- Track credit cost and feature type per usage
ALTER TABLE ai_usage ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_usage ADD COLUMN feature_type TEXT;
