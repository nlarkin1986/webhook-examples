-- Multi-Tenant SaaS Schema for Conversation Analysis
-- Migration: 001_initial_schema
-- Date: 2026-01-21

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenants (companies using the service)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(63) UNIQUE NOT NULL,  -- URL identifier: acme-corp
  plan VARCHAR(50) DEFAULT 'standard',  -- standard, professional, enterprise
  status VARCHAR(20) DEFAULT 'active',  -- active, suspended, cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for slug lookups (webhook routing)
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- Gladly credentials (encrypted)
CREATE TABLE gladly_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gladly_host VARCHAR(255) NOT NULL,  -- e.g., company.gladly.com
  gladly_username VARCHAR(255) NOT NULL,  -- API user email
  gladly_api_token_encrypted BYTEA NOT NULL,  -- AES-256-GCM encrypted
  gladly_api_token_iv BYTEA NOT NULL,  -- Initialization vector for decryption
  gladly_api_token_tag BYTEA NOT NULL,  -- Auth tag for GCM
  webhook_secret VARCHAR(255),  -- For Basic Auth on webhooks
  status VARCHAR(20) DEFAULT 'pending',  -- pending, verified, failed
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX idx_gladly_credentials_tenant ON gladly_credentials(tenant_id);

-- Agent configuration (self-service customization)
CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Model selection
  orchestrator_model VARCHAR(50) DEFAULT 'claude-sonnet-4-20250514',
  specialist_model VARCHAR(50) DEFAULT 'claude-3-5-haiku-20241022',

  -- Custom prompts (NULL = use default)
  orchestrator_system_prompt TEXT,
  sentiment_system_prompt TEXT,
  intent_system_prompt TEXT,

  -- Tool toggles (array of enabled tool names)
  enabled_tools JSONB DEFAULT '["get_conversation", "get_conversation_items", "get_customer", "list_topics", "add_topic", "analyze_sentiment", "analyze_intent", "add_note", "complete_task"]'::jsonb,

  -- Behavior settings
  auto_apply_topics BOOLEAN DEFAULT true,
  add_analysis_note BOOLEAN DEFAULT true,
  sentiment_threshold_negative DECIMAL(3,2) DEFAULT -0.3,
  sentiment_threshold_positive DECIMAL(3,2) DEFAULT 0.3,

  -- Topic mappings: {"billing": "topic-uuid-123", "returns": "topic-uuid-456"}
  topic_mappings JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX idx_agent_configs_tenant ON agent_configs(tenant_id);

-- Analysis results (tenant-isolated)
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gladly_customer_id VARCHAR(255) NOT NULL,
  gladly_conversation_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,

  sentiment JSONB,  -- { score, label, confidence, trajectory }
  intent JSONB,  -- { primary_intent, detected_topics, matched_topics }
  topics_applied JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  processing_time_ms INTEGER,
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  analyzed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint prevents duplicate processing
  UNIQUE(tenant_id, gladly_conversation_id, event_type)
);

CREATE INDEX idx_analysis_results_tenant ON analysis_results(tenant_id);
CREATE INDEX idx_analysis_results_customer ON analysis_results(tenant_id, gladly_customer_id);
CREATE INDEX idx_analysis_results_conversation ON analysis_results(tenant_id, gladly_conversation_id);
CREATE INDEX idx_analysis_results_analyzed_at ON analysis_results(analyzed_at DESC);

-- Admin users (portal access)
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin',  -- admin, viewer
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

CREATE INDEX idx_admin_users_tenant ON admin_users(tenant_id);
CREATE INDEX idx_admin_users_email ON admin_users(email);

-- Audit log for security-sensitive operations
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,  -- credential_created, credential_updated, config_changed, etc.
  resource_type VARCHAR(50),  -- tenant, credential, config
  resource_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- Row-Level Security (RLS)
-- Enforces tenant isolation at the database level
-- ============================================================================

ALTER TABLE gladly_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own tenant's data
-- The app sets current_setting('app.current_tenant_id') before queries

CREATE POLICY tenant_isolation_gladly_credentials ON gladly_credentials
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_agent_configs ON agent_configs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_analysis_results ON analysis_results
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_admin_users ON admin_users
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR tenant_id IS NULL);

-- ============================================================================
-- Default Agent Config Trigger
-- Automatically creates agent_config when a tenant is created
-- ============================================================================

CREATE OR REPLACE FUNCTION create_default_agent_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_configs (tenant_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_default_agent_config
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION create_default_agent_config();

-- ============================================================================
-- Updated_at Trigger
-- Automatically updates updated_at timestamp on row changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_gladly_credentials_updated_at
  BEFORE UPDATE ON gladly_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_agent_configs_updated_at
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
