/**
 * Analysis Controller
 *
 * Handles analysis history and statistics.
 */

const analysisService = require('../../services/analysis-service');
const db = require('../../db/connection');

/**
 * GET /api/admin/analysis
 * List recent analyses with pagination
 */
async function listAnalyses(req, res) {
  const {
    limit = 50,
    offset = 0,
    since
  } = req.query;

  try {
    const sinceDate = since ? new Date(since) : undefined;

    const { results, total } = await analysisService.getRecentAnalyses(
      req.user.tenantId,
      {
        limit: Math.min(parseInt(limit, 10), 100),
        offset: parseInt(offset, 10),
        since: sinceDate
      }
    );

    res.json({
      analyses: results.map(formatAnalysis),
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('[Analysis] List analyses error:', error.message);
    res.status(500).json({ error: 'Failed to list analyses' });
  }
}

/**
 * GET /api/admin/analysis/stats
 * Get analysis statistics
 */
async function getStats(req, res) {
  const { period = '7d' } = req.query;

  try {
    // Calculate since date based on period
    let since;
    switch (period) {
      case '24h':
        since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        since = undefined;
        break;
      default:
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const stats = await analysisService.getStats(req.user.tenantId, since);

    // Get daily counts for the period
    const dailyCounts = await getDailyCounts(req.user.tenantId, since);

    res.json({
      period,
      stats: {
        totalAnalyses: stats.totalCount,
        successRate: stats.totalCount > 0
          ? ((stats.successCount / stats.totalCount) * 100).toFixed(1)
          : 0,
        avgProcessingTime: Math.round(stats.avgProcessingTimeMs),
        uniqueCustomers: stats.uniqueCustomers,
        uniqueConversations: stats.uniqueConversations
      },
      sentimentDistribution: stats.sentimentDistribution,
      topIntents: stats.topIntents,
      dailyCounts
    });
  } catch (error) {
    console.error('[Analysis] Get stats error:', error.message);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
}

/**
 * GET /api/admin/analysis/:id
 * Get specific analysis by ID
 */
async function getAnalysis(req, res) {
  const { id } = req.params;

  try {
    const result = await db.query(`
      SELECT *
      FROM analysis_results
      WHERE id = $1 AND tenant_id = $2
    `, [id, req.user.tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json(formatAnalysis(result.rows[0]));
  } catch (error) {
    console.error('[Analysis] Get analysis error:', error.message);
    res.status(500).json({ error: 'Failed to get analysis' });
  }
}

/**
 * Get daily analysis counts for charting
 */
async function getDailyCounts(tenantId, since) {
  const whereClause = since ? 'AND analyzed_at >= $2' : '';
  const params = since ? [tenantId, since] : [tenantId];

  const result = await db.query(`
    SELECT
      DATE(analyzed_at) as date,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE success = true) as success,
      COUNT(*) FILTER (WHERE success = false) as failed
    FROM analysis_results
    WHERE tenant_id = $1 ${whereClause}
    GROUP BY DATE(analyzed_at)
    ORDER BY date DESC
    LIMIT 30
  `, params);

  return result.rows.map(row => ({
    date: row.date,
    total: parseInt(row.total, 10),
    success: parseInt(row.success, 10),
    failed: parseInt(row.failed, 10)
  })).reverse();
}

/**
 * Format analysis result for API response
 */
function formatAnalysis(row) {
  return {
    id: row.id,
    customerId: row.gladly_customer_id,
    conversationId: row.gladly_conversation_id,
    eventType: row.event_type,
    sentiment: row.sentiment,
    intent: row.intent,
    topicsApplied: row.topics_applied,
    summary: row.summary,
    processingTimeMs: row.processing_time_ms,
    success: row.success,
    errorMessage: row.error_message,
    analyzedAt: row.analyzed_at
  };
}

module.exports = {
  listAnalyses,
  getStats,
  getAnalysis
};
