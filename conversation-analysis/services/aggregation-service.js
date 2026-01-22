/**
 * Aggregation Service
 *
 * Rolls up feedback_items into daily aggregates:
 * - Product feedback aggregates
 * - Topic aggregates
 * - Geographic aggregates
 *
 * Uses advisory locks to prevent UPSERT race conditions when
 * multiple aggregation jobs run in parallel.
 *
 * Runs as scheduled job (e.g., every hour for rolling updates)
 */

const crypto = require('crypto');
const db = require('../db/connection');

// ============================================================================
// Advisory Lock Helper
// Prevents race conditions during parallel aggregation
// ============================================================================

/**
 * Generate deterministic lock key for advisory locks
 * @param {string} tenantId - Tenant UUID
 * @param {string} dimension - Aggregation dimension (product, topic, geo)
 * @param {string} date - Date string
 * @returns {number} 32-bit integer lock key
 */
function getLockKey(tenantId, dimension, date) {
  const hash = crypto.createHash('md5')
    .update(`${tenantId}:${dimension}:${date}`)
    .digest();
  return hash.readInt32BE(0);
}

/**
 * Execute aggregation with advisory lock
 * @param {string} tenantId - Tenant UUID
 * @param {string} dimension - Aggregation dimension
 * @param {string} date - Date string
 * @param {Function} aggregateFn - Async function to run within lock
 * @returns {Promise<any>} Aggregation result
 */
async function aggregateWithLock(tenantId, dimension, date, aggregateFn) {
  const lockKey = getLockKey(tenantId, dimension, date);
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    // Start transaction - required for pg_advisory_xact_lock to work correctly
    await client.query('BEGIN');

    // Acquire advisory lock (blocks if another process has it)
    // This lock is held until COMMIT or ROLLBACK
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // Set tenant context for RLS (local to this transaction)
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    // Run aggregation within lock
    const result = await aggregateFn(client);

    // Commit transaction - releases advisory lock
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Rollback on error - releases advisory lock
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Product Feedback Aggregation
// ============================================================================

/**
 * Aggregate product feedback for a specific date
 * @param {string} tenantId - Tenant UUID
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<number>} Number of products aggregated
 */
async function aggregateProductFeedback(tenantId, dateStr) {
  return aggregateWithLock(tenantId, 'product', dateStr, async (client) => {
    const result = await client.query(`
      WITH daily_data AS (
        SELECT
          shopify_product_id,
          MAX(product_title) as product_title,
          COUNT(*) as total_mentions,
          COUNT(*) FILTER (WHERE is_complaint) as complaint_count,
          COUNT(*) FILTER (WHERE is_praise) as praise_count,
          AVG(sentiment_score) as avg_sentiment,
          COUNT(*) FILTER (WHERE sentiment_label = 'positive') as positive_count,
          COUNT(*) FILTER (WHERE sentiment_label = 'negative') as negative_count,
          COUNT(*) FILTER (WHERE sentiment_label = 'neutral') as neutral_count
        FROM feedback_items
        WHERE tenant_id = $1
          AND DATE(analyzed_at) = $2
          AND shopify_product_id IS NOT NULL
        GROUP BY shopify_product_id
      ),
      issue_dist AS (
        SELECT
          shopify_product_id,
          jsonb_object_agg(
            COALESCE(issue_subcategory, 'other'),
            cnt
          ) as issue_distribution
        FROM (
          SELECT
            shopify_product_id,
            COALESCE(issue_subcategory, 'other') as issue_subcategory,
            COUNT(*) as cnt
          FROM feedback_items
          WHERE tenant_id = $1
            AND DATE(analyzed_at) = $2
            AND shopify_product_id IS NOT NULL
            AND issue_subcategory IS NOT NULL
          GROUP BY shopify_product_id, issue_subcategory
        ) sub
        GROUP BY shopify_product_id
      ),
      top_complaints AS (
        SELECT
          shopify_product_id,
          jsonb_agg(issue_description ORDER BY issue_severity DESC NULLS LAST) as complaints
        FROM (
          SELECT DISTINCT ON (shopify_product_id, issue_description)
            shopify_product_id,
            issue_description,
            issue_severity
          FROM feedback_items
          WHERE tenant_id = $1
            AND DATE(analyzed_at) = $2
            AND shopify_product_id IS NOT NULL
            AND is_complaint = true
            AND issue_description IS NOT NULL
          ORDER BY shopify_product_id, issue_description, issue_severity DESC
          LIMIT 5
        ) sub
        GROUP BY shopify_product_id
      ),
      top_praises AS (
        SELECT
          shopify_product_id,
          jsonb_agg(issue_description ORDER BY sentiment_score DESC NULLS LAST) as praises
        FROM (
          SELECT DISTINCT ON (shopify_product_id, issue_description)
            shopify_product_id,
            issue_description,
            sentiment_score
          FROM feedback_items
          WHERE tenant_id = $1
            AND DATE(analyzed_at) = $2
            AND shopify_product_id IS NOT NULL
            AND is_praise = true
            AND issue_description IS NOT NULL
          ORDER BY shopify_product_id, issue_description, sentiment_score DESC
          LIMIT 3
        ) sub
        GROUP BY shopify_product_id
      )
      INSERT INTO product_feedback_daily (
        tenant_id, shopify_product_id, product_title, feedback_date,
        total_mentions, complaint_count, praise_count,
        avg_sentiment, positive_count, negative_count, neutral_count,
        issue_distribution, top_complaints, top_praises
      )
      SELECT
        $1,
        d.shopify_product_id,
        d.product_title,
        $2::date,
        d.total_mentions,
        d.complaint_count,
        d.praise_count,
        d.avg_sentiment,
        d.positive_count,
        d.negative_count,
        d.neutral_count,
        COALESCE(i.issue_distribution, '{}'::jsonb),
        COALESCE(tc.complaints, '[]'::jsonb),
        COALESCE(tp.praises, '[]'::jsonb)
      FROM daily_data d
      LEFT JOIN issue_dist i ON d.shopify_product_id = i.shopify_product_id
      LEFT JOIN top_complaints tc ON d.shopify_product_id = tc.shopify_product_id
      LEFT JOIN top_praises tp ON d.shopify_product_id = tp.shopify_product_id
      ON CONFLICT (tenant_id, shopify_product_id, feedback_date)
      DO UPDATE SET
        product_title = EXCLUDED.product_title,
        total_mentions = EXCLUDED.total_mentions,
        complaint_count = EXCLUDED.complaint_count,
        praise_count = EXCLUDED.praise_count,
        avg_sentiment = EXCLUDED.avg_sentiment,
        positive_count = EXCLUDED.positive_count,
        negative_count = EXCLUDED.negative_count,
        neutral_count = EXCLUDED.neutral_count,
        issue_distribution = EXCLUDED.issue_distribution,
        top_complaints = EXCLUDED.top_complaints,
        top_praises = EXCLUDED.top_praises
    `, [tenantId, dateStr]);

    console.log(`[Aggregation] Product feedback aggregated for ${dateStr}: ${result.rowCount} products`);
    return result.rowCount;
  });
}

// ============================================================================
// Topic Aggregation
// ============================================================================

/**
 * Aggregate topic data for a specific date with trend detection
 * @param {string} tenantId - Tenant UUID
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<number>} Number of topics aggregated
 */
async function aggregateTopicFeedback(tenantId, dateStr) {
  // Calculate previous period date for trend comparison
  const currentDate = new Date(dateStr);
  const prevDate = new Date(currentDate);
  prevDate.setDate(prevDate.getDate() - 7);
  const prevDateStr = prevDate.toISOString().split('T')[0];

  return aggregateWithLock(tenantId, 'topic', dateStr, async (client) => {
    const result = await client.query(`
      WITH current_topics AS (
        SELECT
          topic->>'topic' as topic,
          COALESCE(topic->>'subtopic', '') as subtopic,
          COUNT(*) as mention_count,
          AVG((topic->>'sentiment')::numeric) as avg_sentiment,
          jsonb_object_agg(
            CASE
              WHEN (topic->>'sentiment')::numeric > 0.3 THEN 'positive'
              WHEN (topic->>'sentiment')::numeric < -0.3 THEN 'negative'
              ELSE 'neutral'
            END,
            1
          ) as sentiment_dist
        FROM feedback_items,
          LATERAL jsonb_array_elements(topics) AS topic
        WHERE tenant_id = $1
          AND DATE(analyzed_at) = $2
        GROUP BY topic->>'topic', topic->>'subtopic'
      ),
      prev_topics AS (
        SELECT
          topic->>'topic' as topic,
          COALESCE(topic->>'subtopic', '') as subtopic,
          COUNT(*) as mention_count
        FROM feedback_items,
          LATERAL jsonb_array_elements(topics) AS topic
        WHERE tenant_id = $1
          AND DATE(analyzed_at) = $3
        GROUP BY topic->>'topic', topic->>'subtopic'
      )
      INSERT INTO topic_daily (
        tenant_id, topic, subtopic, topic_date,
        mention_count, avg_sentiment, sentiment_distribution,
        prev_period_count, change_percentage, is_trending, is_new
      )
      SELECT
        $1,
        ct.topic,
        NULLIF(ct.subtopic, ''),
        $2::date,
        ct.mention_count,
        ct.avg_sentiment,
        ct.sentiment_dist,
        COALESCE(pt.mention_count, 0),
        CASE
          WHEN COALESCE(pt.mention_count, 0) = 0 THEN 100
          ELSE ((ct.mention_count - pt.mention_count)::numeric / pt.mention_count * 100)
        END,
        ct.mention_count > COALESCE(pt.mention_count, 0) * 1.5,
        pt.mention_count IS NULL
      FROM current_topics ct
      LEFT JOIN prev_topics pt ON ct.topic = pt.topic
        AND ct.subtopic = pt.subtopic
      ON CONFLICT (tenant_id, topic, COALESCE(subtopic, ''), topic_date)
      DO UPDATE SET
        mention_count = EXCLUDED.mention_count,
        avg_sentiment = EXCLUDED.avg_sentiment,
        sentiment_distribution = EXCLUDED.sentiment_distribution,
        prev_period_count = EXCLUDED.prev_period_count,
        change_percentage = EXCLUDED.change_percentage,
        is_trending = EXCLUDED.is_trending,
        is_new = EXCLUDED.is_new
    `, [tenantId, dateStr, prevDateStr]);

    console.log(`[Aggregation] Topic feedback aggregated for ${dateStr}: ${result.rowCount} topics`);
    return result.rowCount;
  });
}

// ============================================================================
// Geographic Aggregation
// ============================================================================

/**
 * Aggregate geographic data for a specific date with anomaly detection
 * @param {string} tenantId - Tenant UUID
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<number>} Number of geographic entries aggregated
 */
async function aggregateGeographicFeedback(tenantId, dateStr) {
  return aggregateWithLock(tenantId, 'geo', dateStr, async (client) => {
    const result = await client.query(`
      WITH state_issues AS (
        SELECT
          customer_state,
          COUNT(*) as issue_count,
          AVG(sentiment_score) as avg_sentiment
        FROM feedback_items
        WHERE tenant_id = $1
          AND DATE(analyzed_at) = $2
          AND customer_state IS NOT NULL
        GROUP BY customer_state
      ),
      issue_dist AS (
        SELECT
          customer_state,
          jsonb_object_agg(
            COALESCE(issue_category, 'other'),
            cnt
          ) as issue_distribution
        FROM (
          SELECT
            customer_state,
            COALESCE(issue_category, 'other') as issue_category,
            COUNT(*) as cnt
          FROM feedback_items
          WHERE tenant_id = $1
            AND DATE(analyzed_at) = $2
            AND customer_state IS NOT NULL
          GROUP BY customer_state, issue_category
        ) sub
        GROUP BY customer_state
      ),
      carrier_data AS (
        SELECT
          customer_state,
          jsonb_object_agg(
            shipping_carrier,
            jsonb_build_object(
              'late', late_count,
              'damaged', damaged_count
            )
          ) as carrier_issues
        FROM (
          SELECT
            customer_state,
            shipping_carrier,
            COUNT(*) FILTER (WHERE issue_subcategory ILIKE '%late%' OR issue_subcategory ILIKE '%delay%') as late_count,
            COUNT(*) FILTER (WHERE issue_subcategory ILIKE '%damage%' OR issue_subcategory ILIKE '%broken%') as damaged_count
          FROM feedback_items
          WHERE tenant_id = $1
            AND DATE(analyzed_at) = $2
            AND customer_state IS NOT NULL
            AND shipping_carrier IS NOT NULL
          GROUP BY customer_state, shipping_carrier
        ) sub
        GROUP BY customer_state
      ),
      baseline AS (
        SELECT
          AVG(daily_count) as avg_count,
          STDDEV(daily_count) as std_count
        FROM (
          SELECT
            customer_state,
            DATE(analyzed_at) as day,
            COUNT(*) as daily_count
          FROM feedback_items
          WHERE tenant_id = $1
            AND analyzed_at >= NOW() - INTERVAL '30 days'
            AND customer_state IS NOT NULL
          GROUP BY customer_state, DATE(analyzed_at)
        ) daily_counts
      )
      INSERT INTO geographic_daily (
        tenant_id, geo_level, state_code, geo_date,
        issue_count, issue_distribution, avg_sentiment, carrier_issues,
        z_score, is_anomaly
      )
      SELECT
        $1,
        'state',
        si.customer_state,
        $2::date,
        si.issue_count,
        COALESCE(id.issue_distribution, '{}'::jsonb),
        si.avg_sentiment,
        COALESCE(cd.carrier_issues, '{}'::jsonb),
        CASE WHEN b.std_count > 0
          THEN (si.issue_count - b.avg_count) / b.std_count
          ELSE 0
        END,
        CASE WHEN b.std_count > 0
          THEN (si.issue_count - b.avg_count) / b.std_count > 2
          ELSE false
        END
      FROM state_issues si
      CROSS JOIN baseline b
      LEFT JOIN issue_dist id ON si.customer_state = id.customer_state
      LEFT JOIN carrier_data cd ON si.customer_state = cd.customer_state
      ON CONFLICT (tenant_id, geo_level, COALESCE(state_code, ''), COALESCE(city_name, ''), COALESCE(zip_prefix, ''), geo_date)
      DO UPDATE SET
        issue_count = EXCLUDED.issue_count,
        issue_distribution = EXCLUDED.issue_distribution,
        avg_sentiment = EXCLUDED.avg_sentiment,
        carrier_issues = EXCLUDED.carrier_issues,
        z_score = EXCLUDED.z_score,
        is_anomaly = EXCLUDED.is_anomaly
    `, [tenantId, dateStr]);

    console.log(`[Aggregation] Geographic feedback aggregated for ${dateStr}: ${result.rowCount} regions`);
    return result.rowCount;
  });
}

// ============================================================================
// Unified Aggregation Functions
// ============================================================================

/**
 * Run all aggregations for a specific date
 * @param {string} tenantId - Tenant UUID
 * @param {Date} date - Date to aggregate (defaults to today)
 * @returns {Promise<object>} Aggregation results
 */
async function aggregateDailyFeedback(tenantId, date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];

  console.log(`[Aggregation] Starting daily aggregation for tenant ${tenantId}, date ${dateStr}`);

  const [products, topics, geographic] = await Promise.all([
    aggregateProductFeedback(tenantId, dateStr),
    aggregateTopicFeedback(tenantId, dateStr),
    aggregateGeographicFeedback(tenantId, dateStr)
  ]);

  const result = {
    date: dateStr,
    products_aggregated: products,
    topics_aggregated: topics,
    geographic_aggregated: geographic
  };

  console.log(`[Aggregation] Completed:`, result);
  return result;
}

/**
 * Run aggregations for multiple dates (backfill)
 * @param {string} tenantId - Tenant UUID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of aggregation results
 */
async function backfillAggregations(tenantId, startDate, endDate) {
  const results = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const result = await aggregateDailyFeedback(tenantId, new Date(current));
    results.push(result);
    current.setDate(current.getDate() + 1);
  }

  return results;
}

/**
 * Refresh the materialized view for topic expansion
 * Should be run after aggregation completes
 * @returns {Promise<void>}
 */
async function refreshMaterializedViews() {
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_topics_expanded');
    console.log('[Aggregation] Materialized view refreshed');
  } catch (error) {
    console.error('[Aggregation] Failed to refresh materialized view:', error.message);
  }
}

// ============================================================================
// Scheduled Job Helper
// ============================================================================

/**
 * Run aggregation job for all active tenants
 * Designed to be called by a scheduler (cron, node-schedule, etc.)
 * @returns {Promise<object>} Job results
 */
async function runAggregationJob() {
  const startTime = Date.now();

  // Get all tenants with intelligence enabled
  const tenants = await db.query(`
    SELECT t.id, t.slug
    FROM tenants t
    JOIN agent_configs ac ON t.id = ac.tenant_id
    WHERE t.status = 'active'
      AND ac.intelligence_enabled = true
  `);

  const results = {
    tenants_processed: 0,
    successful: 0,
    failed: 0,
    errors: []
  };

  for (const tenant of tenants.rows) {
    try {
      await aggregateDailyFeedback(tenant.id);
      results.successful++;
    } catch (error) {
      console.error(`[Aggregation] Failed for tenant ${tenant.slug}:`, error.message);
      results.failed++;
      results.errors.push({ tenant: tenant.slug, error: error.message });
    }
    results.tenants_processed++;
  }

  // Refresh materialized views after all tenants processed
  await refreshMaterializedViews();

  results.duration_ms = Date.now() - startTime;
  console.log(`[Aggregation] Job completed:`, results);

  return results;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Main aggregation functions
  aggregateDailyFeedback,
  backfillAggregations,

  // Individual dimension aggregations
  aggregateProductFeedback,
  aggregateTopicFeedback,
  aggregateGeographicFeedback,

  // Utilities
  refreshMaterializedViews,
  runAggregationJob,

  // For testing
  getLockKey,
  aggregateWithLock
};
