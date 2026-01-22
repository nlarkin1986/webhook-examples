-- Customer Intelligence Platform Schema
-- Migration: 003_customer_intelligence
-- Date: 2026-01-21
-- Purpose: Add tables for VoC (Voice of Customer) intelligence, trends, and alerts

-- ============================================================================
-- Feedback Items (individual extractions from conversations)
-- ============================================================================

CREATE TABLE feedback_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Source reference
  conversation_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255),
  analysis_result_id UUID REFERENCES analysis_results(id) ON DELETE SET NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Product reference (if linked)
  shopify_product_id VARCHAR(255),
  shopify_variant_id VARCHAR(255),
  product_title VARCHAR(500),
  product_mention_text TEXT,
  product_link_confidence DECIMAL(3,2),
  product_link_method VARCHAR(50), -- pattern, order_context, fuzzy_catalog, unmatched

  -- Issue classification
  issue_category VARCHAR(100),
  issue_subcategory VARCHAR(100),
  issue_description TEXT,
  issue_severity INT CHECK (issue_severity >= 1 AND issue_severity <= 5),
  is_complaint BOOLEAN DEFAULT false,
  is_praise BOOLEAN DEFAULT false,

  -- Sentiment
  sentiment_score DECIMAL(3,2) CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  sentiment_label VARCHAR(20),

  -- Geographic
  customer_state VARCHAR(2),
  customer_city VARCHAR(100),
  customer_zip_prefix VARCHAR(5),
  shipping_carrier VARCHAR(50),

  -- Topics (multi-label)
  -- Schema: [{"topic": "string", "subtopic": "string", "sentiment": number, "confidence": number}]
  topics JSONB DEFAULT '[]'::jsonb,

  -- Churn signals
  churn_risk VARCHAR(20) CHECK (churn_risk IN ('high', 'medium', 'low')),
  churn_indicators JSONB DEFAULT '[]'::jsonb,

  -- Raw extraction from LLM
  raw_extraction JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for aggregation queries
CREATE INDEX idx_feedback_tenant_product ON feedback_items(tenant_id, shopify_product_id);
CREATE INDEX idx_feedback_tenant_category ON feedback_items(tenant_id, issue_category);
CREATE INDEX idx_feedback_tenant_geo ON feedback_items(tenant_id, customer_state, customer_zip_prefix);
CREATE INDEX idx_feedback_tenant_time ON feedback_items(tenant_id, analyzed_at DESC);
CREATE INDEX idx_feedback_topics ON feedback_items USING GIN(topics);
CREATE INDEX idx_feedback_tenant_time_category ON feedback_items(tenant_id, analyzed_at DESC, issue_category);

-- ============================================================================
-- Product Feedback Daily (aggregated rollup)
-- ============================================================================

CREATE TABLE product_feedback_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Product
  shopify_product_id VARCHAR(255) NOT NULL,
  product_title VARCHAR(500),

  -- Date
  feedback_date DATE NOT NULL,

  -- Volume
  total_mentions INT DEFAULT 0,
  complaint_count INT DEFAULT 0,
  praise_count INT DEFAULT 0,

  -- Sentiment
  avg_sentiment DECIMAL(3,2),
  positive_count INT DEFAULT 0,
  negative_count INT DEFAULT 0,
  neutral_count INT DEFAULT 0,

  -- Issues (distribution)
  -- Schema: {"skin_irritation": 5, "packaging": 2}
  issue_distribution JSONB DEFAULT '{}'::jsonb,

  -- Representative quotes
  top_complaints JSONB DEFAULT '[]'::jsonb,
  top_praises JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, shopify_product_id, feedback_date)
);

CREATE INDEX idx_product_daily_tenant_date ON product_feedback_daily(tenant_id, feedback_date DESC);
CREATE INDEX idx_product_daily_tenant_product ON product_feedback_daily(tenant_id, shopify_product_id);

-- ============================================================================
-- Topic Daily (aggregated rollup)
-- ============================================================================

CREATE TABLE topic_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Topic
  topic VARCHAR(100) NOT NULL,
  subtopic VARCHAR(100),

  -- Date
  topic_date DATE NOT NULL,

  -- Volume
  mention_count INT DEFAULT 0,

  -- Sentiment
  avg_sentiment DECIMAL(3,2),
  sentiment_distribution JSONB DEFAULT '{}'::jsonb,

  -- Trend indicator
  prev_period_count INT,
  change_percentage DECIMAL(5,2),
  is_trending BOOLEAN DEFAULT false,
  is_new BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, topic, COALESCE(subtopic, ''), topic_date)
);

CREATE INDEX idx_topic_daily_tenant_date ON topic_daily(tenant_id, topic_date DESC);
CREATE INDEX idx_topic_daily_tenant_topic ON topic_daily(tenant_id, topic);
CREATE INDEX idx_topic_daily_trending ON topic_daily(tenant_id, is_trending) WHERE is_trending = true;

-- ============================================================================
-- Geographic Daily (aggregated rollup)
-- ============================================================================

CREATE TABLE geographic_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Geography
  geo_level VARCHAR(20) NOT NULL CHECK (geo_level IN ('state', 'city', 'zip_prefix')),
  state_code VARCHAR(2),
  city_name VARCHAR(100),
  zip_prefix VARCHAR(5),

  -- Date
  geo_date DATE NOT NULL,

  -- Volume
  issue_count INT DEFAULT 0,

  -- Issue breakdown
  issue_distribution JSONB DEFAULT '{}'::jsonb,

  -- Sentiment
  avg_sentiment DECIMAL(3,2),

  -- Shipping correlation
  -- Schema: {"FedEx": {"late": 5, "damaged": 2}}
  carrier_issues JSONB DEFAULT '{}'::jsonb,

  -- Statistical significance
  z_score DECIMAL(5,2),
  is_anomaly BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Handle NULL values in unique constraint
  UNIQUE(tenant_id, geo_level, COALESCE(state_code, ''), COALESCE(city_name, ''), COALESCE(zip_prefix, ''), geo_date)
);

CREATE INDEX idx_geo_daily_tenant_date ON geographic_daily(tenant_id, geo_date DESC);
CREATE INDEX idx_geo_daily_anomaly ON geographic_daily(tenant_id, is_anomaly) WHERE is_anomaly = true;

-- ============================================================================
-- Trend Snapshots (hourly/daily detection)
-- ============================================================================

CREATE TABLE trend_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Snapshot time
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_window VARCHAR(20) NOT NULL CHECK (time_window IN ('last_24h', 'last_7d', 'last_30d')),

  -- Trending topics
  trending_topics JSONB DEFAULT '[]'::jsonb,
  emerging_topics JSONB DEFAULT '[]'::jsonb,
  declining_topics JSONB DEFAULT '[]'::jsonb,

  -- Product alerts
  product_alerts JSONB DEFAULT '[]'::jsonb,

  -- Geographic alerts
  geographic_alerts JSONB DEFAULT '[]'::jsonb,

  -- Summary metrics
  total_feedback_count INT,
  avg_sentiment DECIMAL(3,2),
  anomaly_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trend_snapshots_tenant_time ON trend_snapshots(tenant_id, snapshot_at DESC);

-- ============================================================================
-- Intelligence Alerts (actionable notifications)
-- ============================================================================

CREATE TABLE intelligence_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Alert type
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('product_issue', 'trending_topic', 'geographic_cluster', 'emerging_issue', 'sentiment_drop', 'custom')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- Alert content
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Reference data
  reference_type VARCHAR(50) CHECK (reference_type IN ('product', 'topic', 'geography', 'custom')),
  reference_id VARCHAR(255),
  reference_data JSONB,

  -- Metrics that triggered
  metric_name VARCHAR(100),
  metric_value DECIMAL(10,2),
  threshold_value DECIMAL(10,2),

  -- Status
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by VARCHAR(255),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,

  -- Notification tracking
  notifications_sent JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_tenant_status ON intelligence_alerts(tenant_id, status);
CREATE INDEX idx_alerts_tenant_severity ON intelligence_alerts(tenant_id, severity);
CREATE INDEX idx_alerts_tenant_created ON intelligence_alerts(tenant_id, created_at DESC);
CREATE INDEX idx_alerts_open ON intelligence_alerts(tenant_id, status) WHERE status = 'open';

-- ============================================================================
-- Materialized View for Topic Expansion (Performance Optimization)
-- Avoid O(n*m) JSONB expansion on every query
-- ============================================================================

CREATE MATERIALIZED VIEW feedback_topics_expanded AS
SELECT
  fi.id as feedback_id,
  fi.tenant_id,
  fi.analyzed_at,
  fi.conversation_id,
  topic->>'topic' as topic,
  topic->>'subtopic' as subtopic,
  (topic->>'sentiment')::numeric as topic_sentiment,
  (topic->>'confidence')::numeric as topic_confidence
FROM feedback_items fi,
  LATERAL jsonb_array_elements(fi.topics) AS topic;

-- Unique index enables REFRESH CONCURRENTLY
CREATE UNIQUE INDEX ON feedback_topics_expanded(feedback_id, topic, COALESCE(subtopic, ''));
CREATE INDEX ON feedback_topics_expanded(tenant_id, analyzed_at DESC);
CREATE INDEX ON feedback_topics_expanded(tenant_id, topic);

-- ============================================================================
-- Row-Level Security (RLS)
-- ============================================================================

ALTER TABLE feedback_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_feedback_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE geographic_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies with WITH CHECK for secure writes
CREATE POLICY tenant_isolation_feedback ON feedback_items
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_product_daily ON product_feedback_daily
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_topic_daily ON topic_daily
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_geo_daily ON geographic_daily
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_trends ON trend_snapshots
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_alerts ON intelligence_alerts
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

-- ============================================================================
-- Updated_at Trigger for alerts
-- ============================================================================

CREATE TRIGGER trigger_intelligence_alerts_updated_at
  BEFORE UPDATE ON intelligence_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Alert Configuration (added to agent_configs)
-- ============================================================================

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS intelligence_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_thresholds JSONB DEFAULT '{
    "product_z_score": 2,
    "geographic_z_score": 2,
    "emerging_topic_min_mentions": 3,
    "trending_change_percentage": 50,
    "sentiment_drop_threshold": -0.3
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS slack_webhook_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS slack_webhook_iv BYTEA,
  ADD COLUMN IF NOT EXISTS slack_webhook_tag BYTEA,
  ADD COLUMN IF NOT EXISTS alert_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500);

-- ============================================================================
-- Function to refresh materialized view (for scheduled jobs)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_feedback_topics_expanded()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_topics_expanded;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Advisory Lock Helper Function (for UPSERT race condition prevention)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_aggregation_lock_key(
  p_tenant_id UUID,
  p_dimension VARCHAR,
  p_date DATE
) RETURNS BIGINT AS $$
DECLARE
  lock_key BIGINT;
BEGIN
  -- Create deterministic lock key from inputs
  lock_key := ('x' || substr(md5(p_tenant_id::text || ':' || p_dimension || ':' || p_date::text), 1, 8))::bit(32)::bigint;
  RETURN lock_key;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_aggregation_lock_key IS 'Generate deterministic lock key for advisory locks during aggregation';
