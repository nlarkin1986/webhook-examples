-- Customer 360 Dashboard Schema
-- Migration: 004_customer_360
-- Date: 2026-01-21
--
-- Creates tables for Customer 360 Dashboard:
-- - shopify_credentials: Encrypted Shopify API credentials
-- - customer_360: Unified customer view with Gladly + Shopify data
-- - tier_thresholds: Configurable tier thresholds per tenant

-- ============================================================================
-- Shopify Credentials (encrypted like Gladly)
-- ============================================================================

CREATE TABLE shopify_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_url VARCHAR(255) NOT NULL,  -- e.g., mystore.myshopify.com
  access_token_encrypted BYTEA NOT NULL,  -- AES-256-GCM encrypted
  access_token_iv BYTEA NOT NULL,  -- Initialization vector
  access_token_tag BYTEA NOT NULL,  -- Auth tag for GCM
  scopes TEXT[] DEFAULT ARRAY['read_customers', 'read_orders'],
  status VARCHAR(50) DEFAULT 'pending',  -- pending, verified, failed
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX idx_shopify_credentials_tenant ON shopify_credentials(tenant_id);

-- ============================================================================
-- Customer 360 Table (Simplified - 15 essential columns)
-- Other data fetched on-demand from Gladly/Shopify
-- ============================================================================

CREATE TABLE customer_360 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity (linked records)
  gladly_customer_id VARCHAR(255) NOT NULL,
  shopify_customer_id VARCHAR(255),

  -- Profile (from Gladly)
  display_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  photo_url TEXT,

  -- Customer Tier (fixed thresholds for O(1) assignment)
  tier VARCHAR(20) DEFAULT 'standard',  -- top, vip, standard, new, at_risk
  tier_reason TEXT,

  -- Shopify Financial Metrics (denormalized for fast queries)
  gross_revenue DECIMAL(12,2) DEFAULT 0,
  net_revenue DECIMAL(12,2) DEFAULT 0,
  ltv DECIMAL(12,2) DEFAULT 0,
  aov DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'USD',
  total_orders INTEGER DEFAULT 0,
  total_returns INTEGER DEFAULT 0,
  last_transaction_at TIMESTAMPTZ,

  -- AI Analysis Aggregates
  total_conversations INTEGER DEFAULT 0,
  avg_sentiment_score DECIMAL(3,2),
  latest_sentiment_label VARCHAR(50),

  -- Sync Timestamps
  gladly_synced_at TIMESTAMPTZ,
  shopify_synced_at TIMESTAMPTZ,

  -- Standard timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, gladly_customer_id)
);

-- Indexes for common queries
CREATE INDEX idx_c360_tenant ON customer_360(tenant_id);
CREATE INDEX idx_c360_email ON customer_360(tenant_id, email);
CREATE INDEX idx_c360_shopify ON customer_360(tenant_id, shopify_customer_id);
CREATE INDEX idx_c360_tier ON customer_360(tenant_id, tier);
CREATE INDEX idx_c360_ltv ON customer_360(tenant_id, ltv DESC);
CREATE INDEX idx_c360_last_transaction ON customer_360(tenant_id, last_transaction_at DESC);

-- Covering index for customer list queries (avoids table lookup)
CREATE INDEX idx_c360_list ON customer_360(tenant_id, tier, ltv DESC)
  INCLUDE (display_name, email, total_orders, avg_sentiment_score);

-- Index for email lookups (case-insensitive)
CREATE INDEX idx_c360_email_lookup ON customer_360(tenant_id, lower(email));

-- ============================================================================
-- Tier Thresholds (configurable per tenant, used for O(1) tier assignment)
-- ============================================================================

CREATE TABLE tier_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- LTV thresholds
  top_min_ltv DECIMAL(12,2) DEFAULT 5000,  -- LTV >= $5,000 = Top Customer
  vip_min_ltv DECIMAL(12,2) DEFAULT 2000,  -- LTV >= $2,000 = VIP

  -- Sentiment threshold for at-risk
  at_risk_max_sentiment DECIMAL(3,2) DEFAULT -0.30,  -- sentiment < -0.3 = At Risk

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX idx_tier_thresholds_tenant ON tier_thresholds(tenant_id);

-- ============================================================================
-- Row-Level Security (RLS)
-- ============================================================================

ALTER TABLE shopify_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_360 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_thresholds ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as existing tables)
CREATE POLICY tenant_isolation_shopify_creds ON shopify_credentials
  FOR ALL USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_customer_360 ON customer_360
  FOR ALL USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_tier_thresholds ON tier_thresholds
  FOR ALL USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- ============================================================================
-- Default Tier Thresholds Trigger
-- Automatically creates tier_thresholds when a tenant is created
-- ============================================================================

CREATE OR REPLACE FUNCTION create_default_tier_thresholds()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tier_thresholds (tenant_id) VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_default_tier_thresholds
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION create_default_tier_thresholds();

-- ============================================================================
-- Updated_at Triggers
-- ============================================================================

CREATE TRIGGER trigger_shopify_credentials_updated_at
  BEFORE UPDATE ON shopify_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_customer_360_updated_at
  BEFORE UPDATE ON customer_360
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_tier_thresholds_updated_at
  BEFORE UPDATE ON tier_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Backfill tier_thresholds for existing tenants
-- ============================================================================

INSERT INTO tier_thresholds (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
