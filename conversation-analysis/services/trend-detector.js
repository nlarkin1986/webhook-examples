/**
 * Trend Detection Service
 *
 * Identifies:
 * - Trending topics (increasing mentions)
 * - Emerging issues (new topics that didn't exist)
 * - Declining topics (decreasing mentions)
 * - Statistical anomalies (Z-score, IQR based)
 *
 * Uses ensemble approach for robust detection with false positive
 * reduction via persistence and minimum volume requirements.
 */

const db = require('../db/connection');

// ============================================================================
// Configuration
// ============================================================================

const DEFAULTS = {
  // Minimum mentions before alerting (false positive reduction)
  MIN_MENTIONS: 3,

  // Z-score threshold for anomaly detection
  Z_SCORE_THRESHOLD: 2,

  // Change percentage threshold for trending
  TRENDING_CHANGE_PCT: 50,

  // Sentiment threshold for negative alerts
  NEGATIVE_SENTIMENT_THRESHOLD: -0.3
};

// ============================================================================
// Trend Detector Class
// ============================================================================

class TrendDetector {
  constructor(tenantId, config = {}) {
    this.tenantId = tenantId;
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Detect all trends for a time window
   * @param {string} timeWindow - 'last_24h', 'last_7d', or 'last_30d'
   * @returns {Promise<object>} Trend data
   */
  async detectTrends(timeWindow = 'last_7d') {
    const [trending, emerging, declining, anomalies] = await Promise.all([
      this.getTrendingTopics(timeWindow),
      this.getEmergingTopics(timeWindow),
      this.getDecliningTopics(timeWindow),
      this.detectAnomalies(timeWindow)
    ]);

    return {
      trending,
      emerging,
      declining,
      anomalies,
      summary: this.summarizeTrends(trending, emerging, declining, anomalies)
    };
  }

  /**
   * Get trending topics (increasing mentions)
   * @param {string} timeWindow - Time window
   * @returns {Promise<Array>} Trending topics
   */
  async getTrendingTopics(timeWindow) {
    const days = this.getDaysFromWindow(timeWindow);

    const result = await db.queryWithTenant(this.tenantId, `
      SELECT
        topic,
        subtopic,
        SUM(mention_count) as total_mentions,
        AVG(avg_sentiment) as avg_sentiment,
        AVG(change_percentage) as avg_change,
        BOOL_OR(is_trending) as is_trending
      FROM topic_daily
      WHERE tenant_id = $1
        AND topic_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND is_trending = true
      GROUP BY topic, subtopic
      HAVING AVG(change_percentage) > $2
        AND SUM(mention_count) >= $3
      ORDER BY avg_change DESC
      LIMIT 10
    `, [this.tenantId, this.config.TRENDING_CHANGE_PCT, this.config.MIN_MENTIONS]);

    return result.rows.map(row => ({
      topic: row.topic,
      subtopic: row.subtopic,
      mentions: parseInt(row.total_mentions),
      sentiment: parseFloat(row.avg_sentiment || 0).toFixed(2),
      changePercent: parseFloat(row.avg_change || 0).toFixed(1),
      trend: 'increasing'
    }));
  }

  /**
   * Get emerging topics (new topics that didn't exist before)
   * @param {string} timeWindow - Time window
   * @returns {Promise<Array>} Emerging topics
   */
  async getEmergingTopics(timeWindow) {
    const days = this.getDaysFromWindow(timeWindow);

    const result = await db.queryWithTenant(this.tenantId, `
      SELECT
        topic,
        subtopic,
        SUM(mention_count) as total_mentions,
        AVG(avg_sentiment) as avg_sentiment,
        MIN(topic_date) as first_seen
      FROM topic_daily
      WHERE tenant_id = $1
        AND topic_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND is_new = true
      GROUP BY topic, subtopic
      HAVING SUM(mention_count) >= $2
      ORDER BY total_mentions DESC
      LIMIT 10
    `, [this.tenantId, this.config.MIN_MENTIONS]);

    return result.rows.map(row => ({
      topic: row.topic,
      subtopic: row.subtopic,
      mentions: parseInt(row.total_mentions),
      sentiment: parseFloat(row.avg_sentiment || 0).toFixed(2),
      firstSeen: row.first_seen,
      trend: 'new'
    }));
  }

  /**
   * Get declining topics (decreasing mentions)
   * @param {string} timeWindow - Time window
   * @returns {Promise<Array>} Declining topics
   */
  async getDecliningTopics(timeWindow) {
    const days = this.getDaysFromWindow(timeWindow);

    const result = await db.queryWithTenant(this.tenantId, `
      SELECT
        topic,
        subtopic,
        SUM(mention_count) as total_mentions,
        AVG(change_percentage) as avg_change,
        AVG(avg_sentiment) as avg_sentiment
      FROM topic_daily
      WHERE tenant_id = $1
        AND topic_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND change_percentage < -30
      GROUP BY topic, subtopic
      HAVING SUM(mention_count) >= $2
      ORDER BY avg_change ASC
      LIMIT 10
    `, [this.tenantId, this.config.MIN_MENTIONS]);

    return result.rows.map(row => ({
      topic: row.topic,
      subtopic: row.subtopic,
      mentions: parseInt(row.total_mentions),
      sentiment: parseFloat(row.avg_sentiment || 0).toFixed(2),
      changePercent: parseFloat(row.avg_change || 0).toFixed(1),
      trend: 'declining'
    }));
  }

  /**
   * Detect anomalies across products and geography
   * @param {string} timeWindow - Time window
   * @returns {Promise<object>} Anomalies by type
   */
  async detectAnomalies(timeWindow) {
    const days = this.getDaysFromWindow(timeWindow);

    const [products, geographic] = await Promise.all([
      this.detectProductAnomalies(days),
      this.detectGeographicAnomalies(days)
    ]);

    return { products, geographic };
  }

  /**
   * Detect product anomalies (complaint spikes)
   * @param {number} days - Number of days to analyze
   * @returns {Promise<Array>} Product anomalies
   */
  async detectProductAnomalies(days) {
    const result = await db.queryWithTenant(this.tenantId, `
      WITH product_baseline AS (
        SELECT
          shopify_product_id,
          AVG(complaint_count) as avg_complaints,
          STDDEV(complaint_count) as std_complaints
        FROM product_feedback_daily
        WHERE tenant_id = $1
          AND feedback_date >= CURRENT_DATE - INTERVAL '60 days'
          AND feedback_date < CURRENT_DATE - INTERVAL '7 days'
        GROUP BY shopify_product_id
        HAVING COUNT(*) >= 5
      ),
      recent_products AS (
        SELECT
          shopify_product_id,
          MAX(product_title) as product_title,
          SUM(complaint_count) as recent_complaints,
          SUM(total_mentions) as recent_mentions,
          AVG(avg_sentiment) as recent_sentiment
        FROM product_feedback_daily
        WHERE tenant_id = $1
          AND feedback_date >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY shopify_product_id
      )
      SELECT
        rp.shopify_product_id,
        rp.product_title,
        rp.recent_complaints,
        rp.recent_mentions,
        rp.recent_sentiment,
        pb.avg_complaints,
        pb.std_complaints,
        CASE WHEN pb.std_complaints > 0
          THEN (rp.recent_complaints - pb.avg_complaints) / pb.std_complaints
          ELSE 0
        END as z_score
      FROM recent_products rp
      LEFT JOIN product_baseline pb ON rp.shopify_product_id = pb.shopify_product_id
      WHERE pb.std_complaints > 0
        AND (rp.recent_complaints - pb.avg_complaints) / pb.std_complaints > $2
      ORDER BY z_score DESC
      LIMIT 10
    `, [this.tenantId, this.config.Z_SCORE_THRESHOLD]);

    return result.rows.map(row => ({
      type: 'product',
      productId: row.shopify_product_id,
      productTitle: row.product_title,
      complaints: parseInt(row.recent_complaints),
      mentions: parseInt(row.recent_mentions),
      sentiment: parseFloat(row.recent_sentiment || 0).toFixed(2),
      baseline: parseFloat(row.avg_complaints || 0).toFixed(1),
      zScore: parseFloat(row.z_score || 0).toFixed(2),
      severity: parseFloat(row.z_score) > 3 ? 'critical' : 'high'
    }));
  }

  /**
   * Detect geographic anomalies (regional issue clusters)
   * @param {number} days - Number of days to analyze
   * @returns {Promise<Array>} Geographic anomalies
   */
  async detectGeographicAnomalies(days) {
    const result = await db.queryWithTenant(this.tenantId, `
      SELECT
        state_code,
        SUM(issue_count) as total_issues,
        AVG(z_score) as avg_z_score,
        AVG(avg_sentiment) as avg_sentiment,
        (
          SELECT issue_distribution
          FROM geographic_daily gd2
          WHERE gd2.tenant_id = $1
            AND gd2.state_code = geographic_daily.state_code
          ORDER BY geo_date DESC
          LIMIT 1
        ) as issue_distribution
      FROM geographic_daily
      WHERE tenant_id = $1
        AND geo_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND is_anomaly = true
      GROUP BY state_code
      HAVING AVG(z_score) > $2
      ORDER BY avg_z_score DESC
      LIMIT 10
    `, [this.tenantId, this.config.Z_SCORE_THRESHOLD]);

    return result.rows.map(row => ({
      type: 'geographic',
      state: row.state_code,
      issues: parseInt(row.total_issues),
      sentiment: parseFloat(row.avg_sentiment || 0).toFixed(2),
      zScore: parseFloat(row.avg_z_score || 0).toFixed(2),
      topIssues: row.issue_distribution || {},
      severity: parseFloat(row.avg_z_score) > 3 ? 'critical' : 'high'
    }));
  }

  /**
   * Create a trend summary
   * @param {Array} trending - Trending topics
   * @param {Array} emerging - Emerging topics
   * @param {Array} declining - Declining topics
   * @param {object} anomalies - Anomaly data
   * @returns {object} Summary
   */
  summarizeTrends(trending, emerging, declining, anomalies) {
    const criticalAlerts = [
      ...anomalies.products.filter(a => a.severity === 'critical'),
      ...anomalies.geographic.filter(a => a.severity === 'critical')
    ];

    return {
      trendingCount: trending.length,
      emergingCount: emerging.length,
      decliningCount: declining.length,
      productAnomalies: anomalies.products.length,
      geoAnomalies: anomalies.geographic.length,
      criticalAlerts: criticalAlerts.length,
      topConcern: this.identifyTopConcern(trending, emerging, anomalies),
      negativeEmergingTopics: emerging.filter(t => parseFloat(t.sentiment) < this.config.NEGATIVE_SENTIMENT_THRESHOLD)
    };
  }

  /**
   * Identify the most important concern
   * @param {Array} trending - Trending topics
   * @param {Array} emerging - Emerging topics
   * @param {object} anomalies - Anomaly data
   * @returns {object|null} Top concern
   */
  identifyTopConcern(trending, emerging, anomalies) {
    // Priority: Critical product anomaly > Critical geo anomaly > Negative emerging topic > Top trending
    const criticalProduct = anomalies.products.find(a => a.severity === 'critical');
    if (criticalProduct) {
      return { type: 'product_anomaly', data: criticalProduct };
    }

    const criticalGeo = anomalies.geographic.find(a => a.severity === 'critical');
    if (criticalGeo) {
      return { type: 'geographic_anomaly', data: criticalGeo };
    }

    const negativeEmerging = emerging.find(t =>
      parseFloat(t.sentiment) < this.config.NEGATIVE_SENTIMENT_THRESHOLD
    );
    if (negativeEmerging) {
      return { type: 'emerging_negative', data: negativeEmerging };
    }

    if (trending.length > 0) {
      return { type: 'trending', data: trending[0] };
    }

    return null;
  }

  /**
   * Convert time window to days
   * @param {string} timeWindow - Time window string
   * @returns {number} Number of days
   */
  getDaysFromWindow(timeWindow) {
    switch (timeWindow) {
      case 'last_24h': return 1;
      case 'last_7d': return 7;
      case 'last_30d': return 30;
      default: return 7;
    }
  }

  /**
   * Store a trend snapshot
   * @param {string} timeWindow - Time window
   * @param {object} trendData - Trend detection results
   * @returns {Promise<object>} Stored snapshot
   */
  async storeTrendSnapshot(timeWindow, trendData) {
    const result = await db.queryWithTenant(this.tenantId, `
      INSERT INTO trend_snapshots (
        tenant_id, time_window, snapshot_at,
        trending_topics, emerging_topics, declining_topics,
        product_alerts, geographic_alerts,
        total_feedback_count, avg_sentiment, anomaly_count
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      this.tenantId,
      timeWindow,
      JSON.stringify(trendData.trending),
      JSON.stringify(trendData.emerging),
      JSON.stringify(trendData.declining),
      JSON.stringify(trendData.anomalies.products),
      JSON.stringify(trendData.anomalies.geographic),
      trendData.summary.trendingCount + trendData.summary.emergingCount,
      null, // Could calculate from data
      trendData.summary.productAnomalies + trendData.summary.geoAnomalies
    ]);

    console.log(`[TrendDetector] Stored snapshot for ${timeWindow}`);
    return result.rows[0];
  }

  /**
   * Get recent trend snapshots
   * @param {number} limit - Maximum snapshots to return
   * @returns {Promise<Array>} Recent snapshots
   */
  async getRecentSnapshots(limit = 10) {
    const result = await db.queryWithTenant(this.tenantId, `
      SELECT *
      FROM trend_snapshots
      WHERE tenant_id = $1
      ORDER BY snapshot_at DESC
      LIMIT $2
    `, [this.tenantId, limit]);

    return result.rows;
  }

  /**
   * Compare trends between two periods
   * @param {object} periodA - {start: Date, end: Date}
   * @param {object} periodB - {start: Date, end: Date}
   * @returns {Promise<object>} Comparison data
   */
  async comparePeriods(periodA, periodB) {
    const [dataA, dataB] = await Promise.all([
      this.getPeriodMetrics(periodA.start, periodA.end),
      this.getPeriodMetrics(periodB.start, periodB.end)
    ]);

    return {
      periodA: { ...periodA, metrics: dataA },
      periodB: { ...periodB, metrics: dataB },
      changes: {
        feedbackCount: {
          absolute: dataB.feedbackCount - dataA.feedbackCount,
          percentage: dataA.feedbackCount > 0
            ? ((dataB.feedbackCount - dataA.feedbackCount) / dataA.feedbackCount * 100).toFixed(1)
            : null
        },
        avgSentiment: {
          absolute: (dataB.avgSentiment - dataA.avgSentiment).toFixed(2),
          direction: dataB.avgSentiment > dataA.avgSentiment ? 'improved' : 'declined'
        },
        complaintRate: {
          periodA: dataA.feedbackCount > 0 ? (dataA.complaintCount / dataA.feedbackCount * 100).toFixed(1) : 0,
          periodB: dataB.feedbackCount > 0 ? (dataB.complaintCount / dataB.feedbackCount * 100).toFixed(1) : 0
        }
      }
    };
  }

  /**
   * Get aggregated metrics for a period
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @returns {Promise<object>} Period metrics
   */
  async getPeriodMetrics(start, end) {
    const result = await db.queryWithTenant(this.tenantId, `
      SELECT
        COUNT(*) as feedback_count,
        AVG(sentiment_score) as avg_sentiment,
        COUNT(*) FILTER (WHERE is_complaint) as complaint_count,
        COUNT(*) FILTER (WHERE is_praise) as praise_count,
        COUNT(DISTINCT shopify_product_id) as products_mentioned,
        COUNT(DISTINCT customer_state) as states_affected
      FROM feedback_items
      WHERE tenant_id = $1
        AND analyzed_at >= $2
        AND analyzed_at < $3
    `, [this.tenantId, start, end]);

    const row = result.rows[0];
    return {
      feedbackCount: parseInt(row.feedback_count || 0),
      avgSentiment: parseFloat(row.avg_sentiment || 0),
      complaintCount: parseInt(row.complaint_count || 0),
      praiseCount: parseInt(row.praise_count || 0),
      productsMentioned: parseInt(row.products_mentioned || 0),
      statesAffected: parseInt(row.states_affected || 0)
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a trend detector for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} config - Optional configuration overrides
 * @returns {TrendDetector} Configured trend detector
 */
function createTrendDetector(tenantId, config = {}) {
  return new TrendDetector(tenantId, config);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  TrendDetector,
  createTrendDetector,
  DEFAULTS
};
