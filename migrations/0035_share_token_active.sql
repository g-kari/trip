-- Add is_active column to share_tokens for deactivating share links
ALTER TABLE share_tokens ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
