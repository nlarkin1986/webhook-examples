/**
 * Customer Intelligence API Controller
 *
 * REST API endpoints for:
 * - Trend data (trending, emerging, declining topics)
 * - Product insights
 * - Geographic patterns
 * - Alerts management
 * - Intelligence configuration
 */

const db = require('../../db/connection');
const { createTrendDetector } = require('../../services/trend-detector');
const { createAlertGenerator, loadAlertConfig } = require('../../services/alert-generator');
const { aggregateDailyFeedback } = require('../../services/aggregation-service');

// ============================================================================
// Dashboard & Summary
// ============================================================================

/**
 * GET /api/admin/intelligence/summary
 * Get overall intelligence summary for the dashboard
 */
async function getSummary(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const timeRange = req.query.timeRange || 'last_7d';

    const detector = createTrendDetector(tenantId);
    const trendData = await detector.detectTrends(timeRange);

    // Get additional summary metrics
    const metrics = await db.queryWithTenant(tenantId, `
      SELECT
        COUNT(*) as total_feedback,
        AVG(sentiment_score) as avg_sentiment,
        COUNT(*) FILTER (WHERE is_complaint) as complaint_count,
        COUNT(*) FILTER (WHERE is_praise) as praise_count,
        COUNT(DISTINCT shopify_product_id) as products_mentioned,
        COUNT(DISTINCT customer_state) as states_with_issues
      FROM feedback_items
      WHERE tenant_id = $1
        AND analyzed_at >= CURRENT_DATE - INTERVAL '${timeRange === 'last_24h' ? '1 day' : timeRange === 'last_7d' ? '7 days' : '30 days'}'
    `, [tenantId]);

    // Get open alerts count
    const alertsResult = await db.queryWithTenant(tenantId, `
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') as open_count,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open') as critical_count,
        COUNT(*) FILTER (WHERE severity = 'high' AND status = 'open') as high_count
      FROM intelligence_alerts
      WHERE tenant_id = $1
    `, [tenantId]);

    const metricsRow = metrics.rows[0] || {};
    const alertsRow = alertsResult.rows[0] || {};

    res.json({
      timeRange,
      metrics: {
        totalFeedback: parseInt(metricsRow.total_feedback || 0),
        avgSentiment: parseFloat(metricsRow.avg_sentiment || 0).toFixed(2),
        complaintCount: parseInt(metricsRow.complaint_count || 0),
        praiseCount: parseInt(metricsRow.praise_count || 0),
        productsMentioned: parseInt(metricsRow.products_mentioned || 0),
        statesWithIssues: parseInt(metricsRow.states_with_issues || 0)
      },
      alerts: {
        openCount: parseInt(alertsRow.open_count || 0),
        criticalCount: parseInt(alertsRow.critical_count || 0),
        highCount: parseInt(alertsRow.high_count || 0)
      },
      trends: trendData.summary,
      topConcern: trendData.summary.topConcern
    });
  } catch (error) {
    console.error('[Intelligence] Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch intelligence summary' });
  }
}

// ============================================================================
// Trends
// ============================================================================

/**
 * GET /api/admin/intelligence/trends
 * Get trending, emerging, and declining topics
 */
async function getTrends(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const timeRange = req.query.timeRange || 'last_7d';

    const detector = createTrendDetector(tenantId);
    const trendData = await detector.detectTrends(timeRange);

    res.json({
      timeRange,
      trending: trendData.trending,
      emerging: trendData.emerging,
      declining: trendData.declining,
      summary: trendData.summary
    });
  } catch (error) {
    console.error('[Intelligence] Trends error:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
}

// ============================================================================
// Products
// ============================================================================

/**
 * GET /api/admin/intelligence/products
 * Get product feedback insights
 */
async function getProducts(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const timeRange = req.query.timeRange || 'last_7d';
    const sortBy = req.query.sortBy || 'complaints'; // complaints, sentiment, mentions
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const days = timeRange === 'last_24h' ? 1 : timeRange === 'last_7d' ? 7 : 30;

    let orderBy;
    switch (sortBy) {
      case 'sentiment':
        orderBy = 'avg_sentiment ASC';
        break;
      case 'mentions':
        orderBy = 'total_mentions DESC';
        break;
      default:
        orderBy = 'complaint_count DESC';
    }

    const result = await db.queryWithTenant(tenantId, `
      WITH product_stats AS (
        SELECT
          shopify_product_id,
          MAX(product_title) as product_title,
          SUM(total_mentions) as total_mentions,
          SUM(complaint_count) as complaint_count,
          SUM(praise_count) as praise_count,
          AVG(avg_sentiment) as avg_sentiment,
          (
            SELECT issue_distribution
            FROM product_feedback_daily pfd2
            WHERE pfd2.tenant_id = $1
              AND pfd2.shopify_product_id = product_feedback_daily.shopify_product_id
            ORDER BY feedback_date DESC
            LIMIT 1
          ) as issue_distribution,
          (
            SELECT top_complaints
            FROM product_feedback_daily pfd3
            WHERE pfd3.tenant_id = $1
              AND pfd3.shopify_product_id = product_feedback_daily.shopify_product_id
            ORDER BY feedback_date DESC
            LIMIT 1
          ) as top_complaints
        FROM product_feedback_daily
        WHERE tenant_id = $1
          AND feedback_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY shopify_product_id
      ),
      anomalies AS (
        SELECT DISTINCT shopify_product_id
        FROM product_feedback_daily p1
        WHERE tenant_id = $1
          AND feedback_date >= CURRENT_DATE - INTERVAL '${days} days'
          AND EXISTS (
            SELECT 1 FROM (
              SELECT
                AVG(complaint_count) as avg_comp,
                STDDEV(complaint_count) as std_comp
              FROM product_feedback_daily p2
              WHERE p2.tenant_id = $1
                AND p2.shopify_product_id = p1.shopify_product_id
                AND p2.feedback_date < CURRENT_DATE - INTERVAL '7 days'
              GROUP BY shopify_product_id
              HAVING STDDEV(complaint_count) > 0
            ) baseline
            WHERE p1.complaint_count > baseline.avg_comp + 2 * baseline.std_comp
          )
      )
      SELECT
        ps.*,
        CASE WHEN a.shopify_product_id IS NOT NULL THEN true ELSE false END as is_anomalous
      FROM product_stats ps
      LEFT JOIN anomalies a ON ps.shopify_product_id = a.shopify_product_id
      WHERE ps.shopify_product_id IS NOT NULL
      ORDER BY ${orderBy}
      LIMIT $2
    `, [tenantId, limit]);

    const products = result.rows.map(row => ({
      shopifyProductId: row.shopify_product_id,
      productTitle: row.product_title || 'Unknown Product',
      totalMentions: parseInt(row.total_mentions || 0),
      complaintCount: parseInt(row.complaint_count || 0),
      praiseCount: parseInt(row.praise_count || 0),
      avgSentiment: parseFloat(row.avg_sentiment || 0),
      topIssues: row.issue_distribution || {},
      topComplaints: row.top_complaints || [],
      isAnomalous: row.is_anomalous
    }));

    res.json({
      timeRange,
      sortBy,
      products
    });
  } catch (error) {
    console.error('[Intelligence] Products error:', error);
    res.status(500).json({ error: 'Failed to fetch product insights' });
  }
}

/**
 * GET /api/admin/intelligence/products/:productId
 * Get detailed feedback for a specific product
 */
async function getProductDetail(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const productId = req.params.productId;
    const includeQuotes = req.query.includeQuotes !== 'false';
    const includeTimeline = req.query.includeTimeline !== 'false';

    // Get product summary
    const summaryResult = await db.queryWithTenant(tenantId, `
      SELECT
        shopify_product_id,
        MAX(product_title) as product_title,
        SUM(total_mentions) as total_mentions,
        SUM(complaint_count) as complaint_count,
        SUM(praise_count) as praise_count,
        AVG(avg_sentiment) as avg_sentiment
      FROM product_feedback_daily
      WHERE tenant_id = $1 AND shopify_product_id = $2
      GROUP BY shopify_product_id
    `, [tenantId, productId]);

    if (summaryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const summary = summaryResult.rows[0];
    const response = {
      shopifyProductId: summary.shopify_product_id,
      productTitle: summary.product_title,
      totalMentions: parseInt(summary.total_mentions || 0),
      complaintCount: parseInt(summary.complaint_count || 0),
      praiseCount: parseInt(summary.praise_count || 0),
      avgSentiment: parseFloat(summary.avg_sentiment || 0)
    };

    // Get quotes if requested
    if (includeQuotes) {
      const quotesResult = await db.queryWithTenant(tenantId, `
        SELECT
          issue_description,
          issue_category,
          issue_subcategory,
          sentiment_score,
          is_complaint,
          is_praise,
          analyzed_at
        FROM feedback_items
        WHERE tenant_id = $1
          AND shopify_product_id = $2
          AND issue_description IS NOT NULL
        ORDER BY
          CASE WHEN is_complaint THEN 0 ELSE 1 END,
          ABS(sentiment_score) DESC
        LIMIT 20
      `, [tenantId, productId]);

      response.quotes = quotesResult.rows;
    }

    // Get timeline if requested
    if (includeTimeline) {
      const timelineResult = await db.queryWithTenant(tenantId, `
        SELECT
          feedback_date,
          total_mentions,
          complaint_count,
          praise_count,
          avg_sentiment
        FROM product_feedback_daily
        WHERE tenant_id = $1 AND shopify_product_id = $2
        ORDER BY feedback_date DESC
        LIMIT 30
      `, [tenantId, productId]);

      response.timeline = timelineResult.rows.reverse();
    }

    res.json(response);
  } catch (error) {
    console.error('[Intelligence] Product detail error:', error);
    res.status(500).json({ error: 'Failed to fetch product detail' });
  }
}

// ============================================================================
// Geographic
// ============================================================================

/**
 * GET /api/admin/intelligence/geographic
 * Get geographic patterns and anomalies
 */
async function getGeographic(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const timeRange = req.query.timeRange || 'last_7d';
    const geoLevel = req.query.geoLevel || 'state';
    const onlyAnomalies = req.query.onlyAnomalies === 'true';

    const days = timeRange === 'last_24h' ? 1 : timeRange === 'last_7d' ? 7 : 30;

    let whereClause = 'tenant_id = $1 AND geo_level = $2 AND geo_date >= CURRENT_DATE - INTERVAL \'' + days + ' days\'';
    if (onlyAnomalies) {
      whereClause += ' AND is_anomaly = true';
    }

    const result = await db.queryWithTenant(tenantId, `
      SELECT
        state_code,
        city_name,
        zip_prefix,
        SUM(issue_count) as total_issues,
        AVG(avg_sentiment) as avg_sentiment,
        AVG(z_score) as avg_z_score,
        BOOL_OR(is_anomaly) as has_anomaly,
        (
          SELECT issue_distribution
          FROM geographic_daily gd2
          WHERE gd2.tenant_id = $1
            AND gd2.state_code = geographic_daily.state_code
            AND gd2.geo_level = $2
          ORDER BY geo_date DESC
          LIMIT 1
        ) as issue_distribution,
        (
          SELECT carrier_issues
          FROM geographic_daily gd3
          WHERE gd3.tenant_id = $1
            AND gd3.state_code = geographic_daily.state_code
            AND gd3.geo_level = $2
          ORDER BY geo_date DESC
          LIMIT 1
        ) as carrier_issues
      FROM geographic_daily
      WHERE ${whereClause}
      GROUP BY state_code, city_name, zip_prefix
      ORDER BY total_issues DESC
      LIMIT 50
    `, [tenantId, geoLevel]);

    const regions = result.rows.map(row => ({
      stateCode: row.state_code,
      cityName: row.city_name,
      zipPrefix: row.zip_prefix,
      totalIssues: parseInt(row.total_issues || 0),
      avgSentiment: parseFloat(row.avg_sentiment || 0),
      zScore: parseFloat(row.avg_z_score || 0),
      hasAnomaly: row.has_anomaly,
      issueDistribution: row.issue_distribution || {},
      carrierIssues: row.carrier_issues || {}
    }));

    res.json({
      timeRange,
      geoLevel,
      regions
    });
  } catch (error) {
    console.error('[Intelligence] Geographic error:', error);
    res.status(500).json({ error: 'Failed to fetch geographic data' });
  }
}

// ============================================================================
// Alerts
// ============================================================================

/**
 * GET /api/admin/intelligence/alerts
 * List intelligence alerts
 */
async function getAlerts(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const status = req.query.status || 'open';
    const severity = req.query.severity;
    const alertType = req.query.alertType;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const config = await loadAlertConfig(tenantId);
    const generator = createAlertGenerator(tenantId, config);

    const alerts = await generator.getOpenAlerts({
      status: status === 'all' ? undefined : status,
      severity,
      alertType,
      limit
    });

    res.json({ alerts });
  } catch (error) {
    console.error('[Intelligence] Alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
}

/**
 * GET /api/admin/intelligence/alerts/:id
 * Get a specific alert
 */
async function getAlert(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const alertId = req.params.id;

    const result = await db.queryWithTenant(tenantId, `
      SELECT * FROM intelligence_alerts
      WHERE tenant_id = $1 AND id = $2
    `, [tenantId, alertId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert: result.rows[0] });
  } catch (error) {
    console.error('[Intelligence] Get alert error:', error);
    res.status(500).json({ error: 'Failed to fetch alert' });
  }
}

/**
 * PATCH /api/admin/intelligence/alerts/:id
 * Update alert status
 */
async function updateAlert(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const alertId = req.params.id;
    const { status, note } = req.body;

    if (!['acknowledged', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const config = await loadAlertConfig(tenantId);
    const generator = createAlertGenerator(tenantId, config);

    const alert = await generator.updateAlertStatus(
      alertId,
      status,
      note,
      req.user.email
    );

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert });
  } catch (error) {
    console.error('[Intelligence] Update alert error:', error);
    res.status(500).json({ error: 'Failed to update alert' });
  }
}

/**
 * POST /api/admin/intelligence/alerts
 * Create a custom alert
 */
async function createCustomAlert(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { title, description, severity, referenceType, referenceId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const config = await loadAlertConfig(tenantId);
    const generator = createAlertGenerator(tenantId, config);

    const alert = await generator.createCustomAlert({
      title,
      description,
      severity: severity || 'medium',
      referenceType,
      referenceId
    });

    res.status(201).json({ alert });
  } catch (error) {
    console.error('[Intelligence] Create alert error:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
}

// ============================================================================
// Feedback Items
// ============================================================================

/**
 * GET /api/admin/intelligence/feedback
 * List feedback items with filters
 */
async function listFeedback(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const {
      productId,
      issueCategory,
      sentiment,  // 'positive', 'negative', 'neutral'
      state,
      limit = 50,
      offset = 0
    } = req.query;

    let whereClause = 'tenant_id = $1';
    const params = [tenantId];
    let paramIndex = 2;

    if (productId) {
      whereClause += ` AND shopify_product_id = $${paramIndex++}`;
      params.push(productId);
    }

    if (issueCategory) {
      whereClause += ` AND issue_category = $${paramIndex++}`;
      params.push(issueCategory);
    }

    if (sentiment) {
      whereClause += ` AND sentiment_label = $${paramIndex++}`;
      params.push(sentiment);
    }

    if (state) {
      whereClause += ` AND customer_state = $${paramIndex++}`;
      params.push(state);
    }

    const result = await db.queryWithTenant(tenantId, `
      SELECT *
      FROM feedback_items
      WHERE ${whereClause}
      ORDER BY analyzed_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, Math.min(parseInt(limit), 100), parseInt(offset) || 0]);

    res.json({ feedback: result.rows });
  } catch (error) {
    console.error('[Intelligence] List feedback error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
}

/**
 * GET /api/admin/intelligence/feedback/search
 * Full-text search across feedback
 */
async function searchFeedback(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const query = req.query.q;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const result = await db.queryWithTenant(tenantId, `
      SELECT *
      FROM feedback_items
      WHERE tenant_id = $1
        AND (
          issue_description ILIKE $2
          OR product_title ILIKE $2
          OR product_mention_text ILIKE $2
          OR topics::text ILIKE $2
        )
      ORDER BY analyzed_at DESC
      LIMIT $3
    `, [tenantId, `%${query}%`, limit]);

    res.json({ feedback: result.rows, query });
  } catch (error) {
    console.error('[Intelligence] Search feedback error:', error);
    res.status(500).json({ error: 'Failed to search feedback' });
  }
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * GET /api/admin/intelligence/config
 * Get intelligence configuration
 */
async function getIntelligenceConfig(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const result = await db.queryWithTenant(tenantId, `
      SELECT
        intelligence_enabled,
        alert_thresholds,
        alert_email,
        webhook_url,
        CASE WHEN slack_webhook_encrypted IS NOT NULL THEN true ELSE false END as slack_configured
      FROM agent_configs
      WHERE tenant_id = $1
    `, [tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Config not found' });
    }

    res.json({ config: result.rows[0] });
  } catch (error) {
    console.error('[Intelligence] Get config error:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
}

/**
 * PATCH /api/admin/intelligence/config
 * Update intelligence configuration
 */
async function updateIntelligenceConfig(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const {
      intelligenceEnabled,
      alertThresholds,
      alertEmail,
      webhookUrl,
      slackWebhook
    } = req.body;

    const updates = [];
    const params = [tenantId];
    let paramIndex = 2;

    if (typeof intelligenceEnabled === 'boolean') {
      updates.push(`intelligence_enabled = $${paramIndex++}`);
      params.push(intelligenceEnabled);
    }

    if (alertThresholds) {
      updates.push(`alert_thresholds = $${paramIndex++}`);
      params.push(JSON.stringify(alertThresholds));
    }

    if (alertEmail !== undefined) {
      updates.push(`alert_email = $${paramIndex++}`);
      params.push(alertEmail || null);
    }

    if (webhookUrl !== undefined) {
      updates.push(`webhook_url = $${paramIndex++}`);
      params.push(webhookUrl || null);
    }

    // Handle Slack webhook encryption
    if (slackWebhook !== undefined) {
      const credentialService = require('../../services/credential-service');
      if (slackWebhook) {
        const encrypted = credentialService.encrypt(slackWebhook);
        updates.push(`slack_webhook_encrypted = $${paramIndex++}`);
        params.push(encrypted.encrypted);
        updates.push(`slack_webhook_iv = $${paramIndex++}`);
        params.push(encrypted.iv);
        updates.push(`slack_webhook_tag = $${paramIndex++}`);
        params.push(encrypted.tag);
      } else {
        updates.push('slack_webhook_encrypted = NULL');
        updates.push('slack_webhook_iv = NULL');
        updates.push('slack_webhook_tag = NULL');
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const result = await db.queryWithTenant(tenantId, `
      UPDATE agent_configs
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE tenant_id = $1
      RETURNING intelligence_enabled, alert_thresholds, alert_email, webhook_url,
        CASE WHEN slack_webhook_encrypted IS NOT NULL THEN true ELSE false END as slack_configured
    `, params);

    res.json({ config: result.rows[0] });
  } catch (error) {
    console.error('[Intelligence] Update config error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
}

// ============================================================================
// Manual Operations
// ============================================================================

/**
 * POST /api/admin/intelligence/aggregate
 * Manually trigger aggregation (admin only)
 */
async function triggerAggregation(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const date = req.body.date ? new Date(req.body.date) : new Date();

    const result = await aggregateDailyFeedback(tenantId, date);

    res.json({
      message: 'Aggregation completed',
      result
    });
  } catch (error) {
    console.error('[Intelligence] Aggregation error:', error);
    res.status(500).json({ error: 'Failed to run aggregation' });
  }
}

/**
 * POST /api/admin/intelligence/detect-trends
 * Manually trigger trend detection and alert generation
 */
async function triggerTrendDetection(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const timeRange = req.body.timeRange || 'last_7d';

    const detector = createTrendDetector(tenantId);
    const trendData = await detector.detectTrends(timeRange);

    // Store snapshot
    await detector.storeTrendSnapshot(timeRange, trendData);

    // Generate alerts
    const config = await loadAlertConfig(tenantId);
    const generator = createAlertGenerator(tenantId, config);
    const alerts = await generator.generateAlerts(trendData);

    res.json({
      message: 'Trend detection completed',
      trends: trendData.summary,
      alertsCreated: alerts.length
    });
  } catch (error) {
    console.error('[Intelligence] Trend detection error:', error);
    res.status(500).json({ error: 'Failed to run trend detection' });
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Dashboard
  getSummary,

  // Trends
  getTrends,

  // Products
  getProducts,
  getProductDetail,

  // Geographic
  getGeographic,

  // Alerts
  getAlerts,
  getAlert,
  updateAlert,
  createCustomAlert,

  // Feedback
  listFeedback,
  searchFeedback,

  // Config
  getIntelligenceConfig,
  updateIntelligenceConfig,

  // Manual operations
  triggerAggregation,
  triggerTrendDetection
};
