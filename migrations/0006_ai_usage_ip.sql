-- Add IP-based rate limiting for AI generation
-- Allows tracking usage by IP address for non-logged-in abuse prevention

-- Make user_id nullable and add ip_address column
ALTER TABLE ai_usage ADD COLUMN ip_address TEXT;

-- Create index for IP-based lookups
CREATE INDEX idx_ai_usage_ip_date ON ai_usage(ip_address, created_at);
