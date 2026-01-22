/**
 * Analysis Service
 *
 * Handles storage and retrieval of conversation analysis results.
 * Uses PostgreSQL with tenant isolation.
 */

const db = require('../db/connection');

/**
 * Store analysis results
 * @param {object} data - Analysis data
 * @param {string} data.tenantId - Tenant UUID
 * @param {string} data.customerId - Gladly customer ID
 * @param {string} data.conversationId - Gladly conversation ID
 * @param {string} data.eventType - CONVERSATION/CREATED or CONVERSATION/CLOSED
 * @param {object} [data.sentiment] - Sentiment analysis results
 * @param {object} [data.intent] - Intent classification results
 * @param {Array} [data.topicsApplied] - Array of applied topic IDs
 * @param {string} [data.summary] - Analysis summary
 * @param {number} [data.processingTimeMs] - Processing time in milliseconds
 * @param {boolean} [data.success] - Whether analysis succeeded
 * @param {string} [data.errorMessage] - Error message if failed
 * @returns {Promise<object>} Stored analysis record
 */
async function storeAnalysis(data) {
  const {
    tenantId,
    customerId,
    conversationId,
    eventType,
    sentiment,
    intent,
    topicsApplied = [],
    summary,
    processingTimeMs,
    success = true,
    errorMessage
  } = data;

  const result = await db.query(`
    INSERT INTO analysis_results (
      tenant_id,
      gladly_customer_id,
      gladly_conversation_id,
      event_type,
      sentiment,
      intent,
      topics_applied,
      summary,
      processing_time_ms,
      success,
      error_message
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (tenant_id, gladly_conversation_id, event_type) DO UPDATE SET
      sentiment = COALESCE(EXCLUDED.sentiment, analysis_results.sentiment),
      intent = COALESCE(EXCLUDED.intent, analysis_results.intent),
      topics_applied = EXCLUDED.topics_applied,
      summary = COALESCE(EXCLUDED.summary, analysis_results.summary),
      processing_time_ms = EXCLUDED.processing_time_ms,
      success = EXCLUDED.success,
      error_message = EXCLUDED.error_message,
      analyzed_at = NOW()
    RETURNING *
  `, [
    tenantId,
    customerId,
    conversationId,
    eventType,
    sentiment ? JSON.stringify(sentiment) : null,
    intent ? JSON.stringify(intent) : null,
    JSON.stringify(topicsApplied),
    summary,
    processingTimeMs,
    success,
    errorMessage
  ]);

  return result.rows[0];
}

/**
 * Get analysis results for a customer (for App Platform data pulls)
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Gladly customer ID
 * @param {number} [limit] - Max results to return (default: 10)
 * @returns {Promise<Array>} List of analysis results
 */
async function getByCustomerId(tenantId, customerId, limit = 10) {
  const result = await db.query(`
    SELECT
      id,
      gladly_customer_id,
      gladly_conversation_id,
      event_type,
      sentiment,
      intent,
      topics_applied,
      summary,
      success,
      analyzed_at
    FROM analysis_results
    WHERE tenant_id = $1 AND gladly_customer_id = $2
    ORDER BY analyzed_at DESC
    LIMIT $3
  `, [tenantId, customerId, limit]);

  return result.rows.map(row => ({
    id: row.id,
    customerId: row.gladly_customer_id,
    conversationId: row.gladly_conversation_id,
    eventType: row.event_type,
    sentiment: row.sentiment,
    intent: row.intent,
    topicsApplied: row.topics_applied,
    summary: row.summary,
    success: row.success,
    analyzedAt: row.analyzed_at
  }));
}

/**
 * Get analysis results for a conversation
 * @param {string} tenantId - Tenant UUID
 * @param {string} conversationId - Gladly conversation ID
 * @returns {Promise<Array>} List of analysis results
 */
async function getByConversationId(tenantId, conversationId) {
  const result = await db.query(`
    SELECT
      id,
      gladly_customer_id,
      gladly_conversation_id,
      event_type,
      sentiment,
      intent,
      topics_applied,
      summary,
      processing_time_ms,
      success,
      error_message,
      analyzed_at
    FROM analysis_results
    WHERE tenant_id = $1 AND gladly_conversation_id = $2
    ORDER BY analyzed_at DESC
  `, [tenantId, conversationId]);

  return result.rows;
}

/**
 * Get recent analyses for a tenant (for dashboard)
 * @param {string} tenantId - Tenant UUID
 * @param {object} options - Query options
 * @param {number} [options.limit] - Max results (default: 50)
 * @param {number} [options.offset] - Offset for pagination
 * @param {Date} [options.since] - Filter to analyses after this date
 * @returns {Promise<object>} { results, total }
 */
async function getRecentAnalyses(tenantId, { limit = 50, offset = 0, since } = {}) {
  let whereClause = 'WHERE tenant_id = $1';
  const values = [tenantId];

  if (since) {
    values.push(since);
    whereClause += ` AND analyzed_at >= $${values.length}`;
  }

  const countResult = await db.query(`
    SELECT COUNT(*) as total FROM analysis_results ${whereClause}
  `, values);

  values.push(limit, offset);
  const result = await db.query(`
    SELECT
      id,
      gladly_customer_id,
      gladly_conversation_id,
      event_type,
      sentiment,
      intent,
      topics_applied,
      summary,
      processing_time_ms,
      success,
      error_message,
      analyzed_at
    FROM analysis_results
    ${whereClause}
    ORDER BY analyzed_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);

  return {
    results: result.rows,
    total: parseInt(countResult.rows[0].total, 10)
  };
}

/**
 * Get analysis statistics for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {Date} [since] - Filter to analyses after this date
 * @returns {Promise<object>} Statistics object
 */
async function getStats(tenantId, since) {
  let whereClause = 'WHERE tenant_id = $1';
  const values = [tenantId];

  if (since) {
    values.push(since);
    whereClause += ` AND analyzed_at >= $${values.length}`;
  }

  const result = await db.query(`
    SELECT
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE success = true) as success_count,
      COUNT(*) FILTER (WHERE success = false) as failure_count,
      AVG(processing_time_ms) FILTER (WHERE success = true) as avg_processing_time,
      COUNT(DISTINCT gladly_customer_id) as unique_customers,
      COUNT(DISTINCT gladly_conversation_id) as unique_conversations
    FROM analysis_results
    ${whereClause}
  `, values);

  const stats = result.rows[0];

  // Get sentiment distribution
  const sentimentResult = await db.query(`
    SELECT
      sentiment->>'label' as label,
      COUNT(*) as count
    FROM analysis_results
    ${whereClause} AND sentiment IS NOT NULL
    GROUP BY sentiment->>'label'
  `, values);

  // Get top intents
  const intentResult = await db.query(`
    SELECT
      intent->>'primary_intent' as intent,
      COUNT(*) as count
    FROM analysis_results
    ${whereClause} AND intent IS NOT NULL
    GROUP BY intent->>'primary_intent'
    ORDER BY count DESC
    LIMIT 10
  `, values);

  return {
    totalCount: parseInt(stats.total_count, 10),
    successCount: parseInt(stats.success_count, 10),
    failureCount: parseInt(stats.failure_count, 10),
    avgProcessingTimeMs: parseFloat(stats.avg_processing_time) || 0,
    uniqueCustomers: parseInt(stats.unique_customers, 10),
    uniqueConversations: parseInt(stats.unique_conversations, 10),
    sentimentDistribution: sentimentResult.rows.reduce((acc, row) => {
      acc[row.label] = parseInt(row.count, 10);
      return acc;
    }, {}),
    topIntents: intentResult.rows.map(row => ({
      intent: row.intent,
      count: parseInt(row.count, 10)
    }))
  };
}

/**
 * Delete old analysis results (data retention)
 * @param {string} tenantId - Tenant UUID
 * @param {number} daysToKeep - Number of days to retain (default: 90)
 * @returns {Promise<number>} Number of deleted records
 */
async function deleteOldAnalyses(tenantId, daysToKeep = 90) {
  const result = await db.query(`
    DELETE FROM analysis_results
    WHERE tenant_id = $1 AND analyzed_at < NOW() - INTERVAL '${daysToKeep} days'
  `, [tenantId]);

  return result.rowCount;
}

module.exports = {
  storeAnalysis,
  getByCustomerId,
  getByConversationId,
  getRecentAnalyses,
  getStats,
  deleteOldAnalyses
};
