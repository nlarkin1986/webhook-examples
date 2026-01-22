/**
 * Customer 360 Service
 *
 * Manages the unified customer view combining data from:
 * - Gladly (conversations, profile)
 * - Shopify (orders, revenue)
 * - AI Analysis (sentiment, intent)
 */

const db = require('../db/connection');
const { calculateCustomerMetrics, assignCustomerTier } = require('./metrics-calculator');

/**
 * Get tier thresholds for a tenant
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object>} Thresholds
 */
async function getTierThresholds(tenantId) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT top_min_ltv, vip_min_ltv, at_risk_max_sentiment
    FROM tier_thresholds
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    // Return defaults if no row exists
    return {
      top_min_ltv: 5000,
      vip_min_ltv: 2000,
      at_risk_max_sentiment: -0.30
    };
  }

  return result.rows[0];
}

/**
 * Update tier thresholds for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} thresholds - Threshold values
 * @returns {Promise<object>} Updated thresholds
 */
async function updateTierThresholds(tenantId, thresholds) {
  const { topMinLtv, vipMinLtv, atRiskMaxSentiment } = thresholds;

  const result = await db.queryWithTenant(tenantId, `
    INSERT INTO tier_thresholds (tenant_id, top_min_ltv, vip_min_ltv, at_risk_max_sentiment)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id) DO UPDATE SET
      top_min_ltv = EXCLUDED.top_min_ltv,
      vip_min_ltv = EXCLUDED.vip_min_ltv,
      at_risk_max_sentiment = EXCLUDED.at_risk_max_sentiment,
      updated_at = NOW()
    RETURNING *
  `, [tenantId, topMinLtv, vipMinLtv, atRiskMaxSentiment]);

  return result.rows[0];
}

/**
 * Find or create a Customer 360 record
 * @param {string} tenantId - Tenant UUID
 * @param {string} gladlyCustomerId - Gladly customer ID
 * @param {object} gladlyProfile - Gladly customer profile
 * @returns {Promise<object>} Customer 360 record
 */
async function findOrCreateCustomer360(tenantId, gladlyCustomerId, gladlyProfile) {
  const result = await db.queryWithTenant(tenantId, `
    INSERT INTO customer_360 (
      tenant_id, gladly_customer_id, display_name, email, phone, photo_url
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, gladly_customer_id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, customer_360.display_name),
      email = COALESCE(EXCLUDED.email, customer_360.email),
      phone = COALESCE(EXCLUDED.phone, customer_360.phone),
      photo_url = COALESCE(EXCLUDED.photo_url, customer_360.photo_url),
      gladly_synced_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `, [
    tenantId,
    gladlyCustomerId,
    gladlyProfile?.name || gladlyProfile?.displayName || null,
    gladlyProfile?.emails?.[0]?.original || gladlyProfile?.email || null,
    gladlyProfile?.phones?.[0]?.original || gladlyProfile?.phone || null,
    gladlyProfile?.image?.url || gladlyProfile?.photoUrl || null
  ]);

  return result.rows[0];
}

/**
 * Get Customer 360 by ID
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @returns {Promise<object|null>} Customer 360 record or null
 */
async function getCustomer360ById(tenantId, customerId) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT * FROM customer_360
    WHERE tenant_id = $1 AND id = $2
  `, [tenantId, customerId]);

  return result.rows[0] || null;
}

/**
 * Get Customer 360 by Gladly customer ID
 * @param {string} tenantId - Tenant UUID
 * @param {string} gladlyCustomerId - Gladly customer ID
 * @returns {Promise<object|null>} Customer 360 record or null
 */
async function getCustomer360ByGladlyId(tenantId, gladlyCustomerId) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT * FROM customer_360
    WHERE tenant_id = $1 AND gladly_customer_id = $2
  `, [tenantId, gladlyCustomerId]);

  return result.rows[0] || null;
}

/**
 * Get Customer 360 by email
 * @param {string} tenantId - Tenant UUID
 * @param {string} email - Customer email
 * @returns {Promise<object|null>} Customer 360 record or null
 */
async function getCustomer360ByEmail(tenantId, email) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT * FROM customer_360
    WHERE tenant_id = $1 AND lower(email) = lower($2)
  `, [tenantId, email]);

  return result.rows[0] || null;
}

/**
 * Update Customer 360 with Shopify metrics
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @param {object} shopifyCustomer - Shopify customer data
 * @param {object} metrics - Calculated metrics
 * @returns {Promise<object>} Updated customer record
 */
async function updateShopifyMetrics(tenantId, customerId, shopifyCustomer, metrics) {
  const result = await db.queryWithTenant(tenantId, `
    UPDATE customer_360 SET
      shopify_customer_id = $3,
      gross_revenue = $4,
      net_revenue = $5,
      ltv = $6,
      aov = $7,
      currency = $8,
      total_orders = $9,
      total_returns = $10,
      last_transaction_at = $11,
      shopify_synced_at = NOW(),
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
  `, [
    tenantId,
    customerId,
    shopifyCustomer.id,
    metrics.grossRevenue,
    metrics.netRevenue,
    metrics.ltv,
    metrics.aov,
    metrics.currency,
    metrics.orderCount,
    metrics.returnCount,
    metrics.lastTransaction
  ]);

  return result.rows[0];
}

/**
 * Update Customer 360 tier
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @param {string} tier - Tier value
 * @param {string} reason - Tier assignment reason
 * @returns {Promise<object>} Updated customer record
 */
async function updateCustomerTier(tenantId, customerId, tier, reason) {
  const result = await db.queryWithTenant(tenantId, `
    UPDATE customer_360 SET
      tier = $3,
      tier_reason = $4,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
  `, [tenantId, customerId, tier, reason]);

  return result.rows[0];
}

/**
 * Update analysis aggregates for a customer
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @returns {Promise<object>} Updated customer record
 */
async function updateAnalysisAggregates(tenantId, customerId) {
  const result = await db.queryWithTenant(tenantId, `
    WITH conversation_stats AS (
      SELECT
        COUNT(*) as total_conversations,
        AVG((sentiment->>'score')::decimal) as avg_sentiment,
        (SELECT sentiment->>'label' FROM analysis_results ar2
         WHERE ar2.tenant_id = $1
           AND ar2.gladly_customer_id = c.gladly_customer_id
         ORDER BY analyzed_at DESC LIMIT 1) as latest_label
      FROM analysis_results ar
      JOIN customer_360 c ON ar.gladly_customer_id = c.gladly_customer_id
        AND ar.tenant_id = c.tenant_id
      WHERE c.id = $2 AND ar.tenant_id = $1
      GROUP BY c.gladly_customer_id
    )
    UPDATE customer_360 SET
      total_conversations = COALESCE(cs.total_conversations, 0),
      avg_sentiment_score = cs.avg_sentiment,
      latest_sentiment_label = cs.latest_label,
      updated_at = NOW()
    FROM conversation_stats cs
    WHERE customer_360.id = $2 AND customer_360.tenant_id = $1
    RETURNING customer_360.*
  `, [tenantId, customerId]);

  return result.rows[0];
}

/**
 * List customers with pagination and filtering
 * @param {string} tenantId - Tenant UUID
 * @param {object} options - Query options
 * @returns {Promise<object>} { data, total, page, pageSize, totalPages }
 */
async function listCustomers(tenantId, options = {}) {
  const {
    search = '',
    tier = null,
    sortBy = 'ltv',
    sortOrder = 'DESC',
    page = 1,
    pageSize = 20
  } = options;

  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions = ['tenant_id = $1'];
  const params = [tenantId];
  let paramIndex = 2;

  if (search) {
    conditions.push(`(display_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (tier) {
    conditions.push(`tier = $${paramIndex}`);
    params.push(tier);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Validate sort column
  const validSortColumns = ['ltv', 'gross_revenue', 'total_orders', 'avg_sentiment_score', 'last_transaction_at', 'created_at', 'display_name'];
  const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'ltv';
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Get total count
  const countResult = await db.queryWithTenant(tenantId, `
    SELECT COUNT(*) as total FROM customer_360 WHERE ${whereClause}
  `, params);

  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated data
  const dataResult = await db.queryWithTenant(tenantId, `
    SELECT
      id, gladly_customer_id, shopify_customer_id,
      display_name, email, phone, photo_url,
      tier, tier_reason,
      gross_revenue, net_revenue, ltv, aov, currency,
      total_orders, total_returns, last_transaction_at,
      total_conversations, avg_sentiment_score, latest_sentiment_label,
      gladly_synced_at, shopify_synced_at,
      created_at, updated_at
    FROM customer_360
    WHERE ${whereClause}
    ORDER BY ${sortColumn} ${order} NULLS LAST
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...params, pageSize, offset]);

  return {
    data: dataResult.rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}

/**
 * Enrich a customer with Shopify data (on-demand)
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @param {object} shopifyClient - Shopify client instance
 * @returns {Promise<object>} Enriched customer record
 */
async function enrichWithShopifyData(tenantId, customerId, shopifyClient) {
  // Get current customer record
  const customer = await getCustomer360ById(tenantId, customerId);
  if (!customer || !customer.email) {
    return customer;
  }

  // Check if data is stale (>1 hour old)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (customer.shopify_synced_at && new Date(customer.shopify_synced_at) > oneHourAgo) {
    // Data is fresh, return as-is
    return customer;
  }

  // Fetch from Shopify
  const shopifyCustomer = await shopifyClient.getCustomerByEmail(customer.email);

  if (!shopifyCustomer) {
    // Mark as synced even if not found
    await db.queryWithTenant(tenantId, `
      UPDATE customer_360 SET shopify_synced_at = NOW() WHERE id = $1
    `, [customerId]);
    return customer;
  }

  // Calculate metrics
  const metrics = calculateCustomerMetrics(shopifyCustomer);

  // Update record
  const updated = await updateShopifyMetrics(tenantId, customerId, shopifyCustomer, metrics);

  // Re-calculate tier
  const thresholds = await getTierThresholds(tenantId);
  const { tier, reason } = assignCustomerTier({
    totalOrders: metrics.orderCount,
    ltv: metrics.ltv,
    avgSentiment: updated.avg_sentiment_score
  }, thresholds);

  await updateCustomerTier(tenantId, customerId, tier, reason);

  // Return fresh data
  return getCustomer360ById(tenantId, customerId);
}

/**
 * Get customer events by fetching from source systems on-demand
 * @param {string} tenantId - Tenant UUID
 * @param {string} customerId - Customer 360 UUID
 * @param {object} clients - { gladlyClient, shopifyClient }
 * @param {object} options - { limit, eventTypes }
 * @returns {Promise<Array>} Merged and sorted events
 */
async function getCustomerEvents(tenantId, customerId, clients, options = {}) {
  const { limit = 50, eventTypes = null } = options;

  const customer = await getCustomer360ById(tenantId, customerId);
  if (!customer) {
    return [];
  }

  const events = [];

  // Get analysis results from database
  if (!eventTypes || eventTypes.includes('analysis')) {
    const analysisResult = await db.queryWithTenant(tenantId, `
      SELECT
        id, gladly_conversation_id, event_type,
        sentiment, intent, summary, analyzed_at
      FROM analysis_results
      WHERE tenant_id = $1 AND gladly_customer_id = $2
      ORDER BY analyzed_at DESC
      LIMIT $3
    `, [tenantId, customer.gladly_customer_id, limit]);

    for (const row of analysisResult.rows) {
      events.push({
        id: row.id,
        eventType: 'analysis',
        eventSource: 'ai',
        eventId: row.gladly_conversation_id,
        title: `Conversation Analysis (${row.event_type})`,
        summary: row.summary,
        metadata: {
          sentiment: row.sentiment,
          intent: row.intent
        },
        occurredAt: row.analyzed_at
      });
    }
  }

  // Get orders from Shopify (if client available and customer has Shopify ID)
  if ((!eventTypes || eventTypes.includes('order')) && clients.shopifyClient && customer.shopify_customer_id) {
    try {
      const shopifyData = await clients.shopifyClient.getCustomerById(customer.shopify_customer_id);
      if (shopifyData?.orders?.edges) {
        for (const edge of shopifyData.orders.edges.slice(0, limit)) {
          const order = edge.node;
          events.push({
            id: order.id,
            eventType: order.displayFinancialStatus === 'REFUNDED' ? 'refund' : 'order',
            eventSource: 'shopify',
            eventId: order.id,
            title: `Order ${order.name}`,
            summary: `${order.displayFinancialStatus} - ${order.displayFulfillmentStatus}`,
            metadata: {
              total: parseFloat(order.totalPriceSet?.shopMoney?.amount || 0),
              currency: order.totalPriceSet?.shopMoney?.currencyCode || 'USD',
              refunded: parseFloat(order.totalRefundedSet?.shopMoney?.amount || 0),
              items: order.lineItems?.edges?.map(e => e.node.title) || []
            },
            occurredAt: order.createdAt
          });
        }
      }
    } catch (error) {
      console.error(`[Customer360] Failed to fetch Shopify orders: ${error.message}`);
    }
  }

  // Sort all events by occurredAt descending
  events.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  return events.slice(0, limit);
}

/**
 * Get dashboard summary stats
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object>} Summary stats
 */
async function getDashboardStats(tenantId) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT
      COUNT(*) as total_customers,
      COUNT(*) FILTER (WHERE tier = 'top') as top_customers,
      COUNT(*) FILTER (WHERE tier = 'vip') as vip_customers,
      COUNT(*) FILTER (WHERE tier = 'at_risk') as at_risk_customers,
      COUNT(*) FILTER (WHERE tier = 'new') as new_customers,
      SUM(ltv) as total_ltv,
      AVG(ltv) as avg_ltv,
      AVG(avg_sentiment_score) as avg_sentiment
    FROM customer_360
    WHERE tenant_id = $1
  `, [tenantId]);

  const row = result.rows[0];
  return {
    totalCustomers: parseInt(row.total_customers, 10) || 0,
    topCustomers: parseInt(row.top_customers, 10) || 0,
    vipCustomers: parseInt(row.vip_customers, 10) || 0,
    atRiskCustomers: parseInt(row.at_risk_customers, 10) || 0,
    newCustomers: parseInt(row.new_customers, 10) || 0,
    totalLtv: parseFloat(row.total_ltv) || 0,
    avgLtv: parseFloat(row.avg_ltv) || 0,
    avgSentiment: parseFloat(row.avg_sentiment) || null
  };
}

module.exports = {
  getTierThresholds,
  updateTierThresholds,
  findOrCreateCustomer360,
  getCustomer360ById,
  getCustomer360ByGladlyId,
  getCustomer360ByEmail,
  updateShopifyMetrics,
  updateCustomerTier,
  updateAnalysisAggregates,
  listCustomers,
  enrichWithShopifyData,
  getCustomerEvents,
  getDashboardStats
};
