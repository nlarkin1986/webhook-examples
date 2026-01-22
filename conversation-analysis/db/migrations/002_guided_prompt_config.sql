-- Migration: Add guided prompt builder configuration
-- Description: Adds JSONB column for structured prompt builder UI configuration
-- Created: 2026-01-21

BEGIN;

-- Add guided configuration column with safe defaults
ALTER TABLE agent_configs
ADD COLUMN IF NOT EXISTS guided_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_agent_configs_guided_config
ON agent_configs USING GIN (guided_config);

COMMIT;
