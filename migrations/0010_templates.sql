-- Add template columns to trips table
ALTER TABLE trips ADD COLUMN is_template INTEGER DEFAULT 0;
ALTER TABLE trips ADD COLUMN template_uses INTEGER DEFAULT 0;
