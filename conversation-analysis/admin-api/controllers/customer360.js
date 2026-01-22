/**
 * Customer 360 API Controller
 *
 * REST API endpoints for:
 * - Customer list with filtering/sorting
 * - Customer 360 detail view
 * - Customer event activity stream
 * - Shopify integration management
 * - Dashboard stats
 */

const customer360Service = require('../../services/customer-360-service');
const shopifyCredentialService = require('../../services/shopify-credential-service');
const { createShopifyClient, testConnection } = require('../../services/shopify-client');
const { calculateCustomerMetrics } = require('../../services/metrics-calculator');

// ============================================================================
// UUID Validation
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(id) {
  return UUID_REGEX.test(id);
}

// ============================================================================
// Dashboard & Stats
// ============================================================================

/**
 * GET /api/admin/customers/stats
 * Get Customer 360 dashboard statistics
 */
async function getStats(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const stats = await customer360Service.getDashboardStats(tenantId);

    res.json(stats);
  } catch (error) {
    console.error('[Customer360] Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch customer stats' });
  }
}

// ============================================================================
// Customer List
// ============================================================================

/**
 * GET /api/admin/customers
 * List customers with filtering and sorting
 */
async function listCustomers(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const {
      tier,
      search,
      sortBy = 'ltv',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20
    } = req.query;

    const result = await customer360Service.listCustomers(tenantId, {
      tier,
      search,
      sortBy,
      sortOrder,
      page: parseInt(page),
      pageSize: Math.min(parseInt(pageSize), 100)
    });

    res.json({
      data: result.data,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize)
      }
    });
  } catch (error) {
    console.error('[Customer360] List error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
}

// ============================================================================
// Customer Detail
// ============================================================================

/**
 * GET /api/admin/customers/:id
 * Get full customer 360 profile
 */
async function getCustomer(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const customerId = req.params.id;

    if (!isValidUUID(customerId)) {
      return res.status(400).json({ error: 'Invalid customer ID format' });
    }

    const customer = await customer360Service.getCustomer360ById(tenantId, customerId);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ customer });
  } catch (error) {
    console.error('[Customer360] Get customer error:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
}

/**
 * GET /api/admin/customers/gladly/:gladlyCustomerId
 * Get customer by Gladly customer ID
 */
async function getCustomerByGladlyId(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const gladlyCustomerId = req.params.gladlyCustomerId;

    if (!isValidUUID(gladlyCustomerId)) {
      return res.status(400).json({ error: 'Invalid Gladly customer ID format' });
    }

    const customer = await customer360Service.getCustomer360ByGladlyId(tenantId, gladlyCustomerId);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ customer });
  } catch (error) {
    console.error('[Customer360] Get by Gladly ID error:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
}

// ============================================================================
// Customer Events
// ============================================================================

/**
 * GET /api/admin/customers/:id/events
 * Get customer activity stream
 */
async function getCustomerEvents(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const customerId = req.params.id;
    const {
      eventTypes,
      limit = 20
    } = req.query;

    if (!isValidUUID(customerId)) {
      return res.status(400).json({ error: 'Invalid customer ID format' });
    }

    // Check customer exists
    const customer = await customer360Service.getCustomer360ById(tenantId, customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get Shopify client if configured
    let shopifyClient = null;
    try {
      const credentials = await shopifyCredentialService.getCredentials(tenantId);
      if (credentials) {
        shopifyClient = createShopifyClient(credentials);
      }
    } catch (e) {
      // Shopify not configured, that's ok
    }

    const events = await customer360Service.getCustomerEvents(
      tenantId,
      customerId,
      { shopifyClient },
      {
        limit: Math.min(parseInt(limit), 100),
        eventTypes: eventTypes ? eventTypes.split(',') : null
      }
    );

    res.json({ events });
  } catch (error) {
    console.error('[Customer360] Events error:', error);
    res.status(500).json({ error: 'Failed to fetch customer events' });
  }
}

// ============================================================================
// Shopify Sync
// ============================================================================

/**
 * POST /api/admin/customers/:id/sync
 * Trigger Shopify data sync for a customer
 */
async function syncCustomer(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const customerId = req.params.id;
    const force = req.body.force === true;

    if (!isValidUUID(customerId)) {
      return res.status(400).json({ error: 'Invalid customer ID format' });
    }

    // Get customer
    const customer = await customer360Service.getCustomer360ById(tenantId, customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (!customer.email) {
      return res.status(400).json({ error: 'Customer has no email for Shopify lookup' });
    }

    // Check if Shopify is configured
    const credentials = await shopifyCredentialService.getCredentials(tenantId);
    if (!credentials) {
      return res.status(400).json({ error: 'Shopify not configured' });
    }

    // Check if data is fresh (unless force)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (!force && customer.shopify_synced_at && new Date(customer.shopify_synced_at) > oneHourAgo) {
      return res.json({
        synced: false,
        message: 'Data is fresh, no sync needed',
        lastSynced: customer.shopify_synced_at
      });
    }

    // Fetch from Shopify
    const client = createShopifyClient(credentials);
    const shopifyCustomer = await client.getCustomerByEmail(customer.email);

    if (!shopifyCustomer) {
      return res.json({
        synced: false,
        message: 'No Shopify customer found for this email'
      });
    }

    // Calculate metrics and update
    const metrics = calculateCustomerMetrics(shopifyCustomer);
    await customer360Service.updateShopifyMetrics(tenantId, customerId, shopifyCustomer, metrics);

    // Update tier
    const thresholds = await customer360Service.getTierThresholds(tenantId);
    const { assignCustomerTier } = require('../../services/metrics-calculator');
    const { tier, reason } = assignCustomerTier({
      totalOrders: metrics.orderCount,
      ltv: metrics.ltv,
      avgSentiment: customer.avg_sentiment_score
    }, thresholds);

    await customer360Service.updateCustomerTier(tenantId, customerId, tier, reason);

    res.json({
      synced: true,
      metrics,
      tier,
      tierReason: reason
    });
  } catch (error) {
    console.error('[Customer360] Sync error:', error);
    res.status(500).json({ error: 'Failed to sync customer data' });
  }
}

// ============================================================================
// Shopify Connection
// ============================================================================

/**
 * GET /api/admin/shopify/connection
 * Get Shopify connection status
 */
async function getShopifyConnection(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const credentials = await shopifyCredentialService.getCredentialsMeta(tenantId);

    if (!credentials) {
      return res.json({
        connected: false,
        storeUrl: null,
        status: null
      });
    }

    res.json({
      connected: true,
      storeUrl: credentials.storeUrl,
      status: credentials.status,
      lastVerifiedAt: credentials.lastVerifiedAt,
      scopes: credentials.scopes
    });
  } catch (error) {
    console.error('[Customer360] Get Shopify connection error:', error);
    res.status(500).json({ error: 'Failed to fetch Shopify connection' });
  }
}

/**
 * POST /api/admin/shopify/connection
 * Save Shopify credentials
 */
async function saveShopifyConnection(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { storeUrl, accessToken, scopes } = req.body;

    if (!storeUrl || !accessToken) {
      return res.status(400).json({ error: 'Store URL and access token are required' });
    }

    // Validate store URL (SSRF protection)
    try {
      shopifyCredentialService.validateShopifyStoreUrl(storeUrl);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // Store credentials
    const credential = await shopifyCredentialService.createCredentials(tenantId, {
      storeUrl,
      accessToken,
      scopes: scopes || ['read_customers', 'read_orders']
    });

    res.json({
      success: true,
      storeUrl: credential.store_url,
      status: credential.status
    });
  } catch (error) {
    console.error('[Customer360] Save Shopify connection error:', error);
    res.status(500).json({ error: 'Failed to save Shopify credentials' });
  }
}

/**
 * POST /api/admin/shopify/test
 * Test Shopify connection
 */
async function testShopifyConnection(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const credentials = await shopifyCredentialService.getCredentials(tenantId);
    if (!credentials) {
      return res.status(400).json({ error: 'Shopify credentials not configured' });
    }

    const result = await testConnection(credentials);

    // Update verification status
    await shopifyCredentialService.updateVerificationStatus(
      tenantId,
      result.success ? 'verified' : 'failed'
    );

    if (result.success) {
      res.json({
        success: true,
        shop: result.shop
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('[Customer360] Test Shopify connection error:', error);
    res.status(500).json({ error: 'Failed to test Shopify connection' });
  }
}

/**
 * DELETE /api/admin/shopify/connection
 * Remove Shopify credentials
 */
async function deleteShopifyConnection(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const deleted = await shopifyCredentialService.deleteCredentials(tenantId);

    res.json({
      success: deleted,
      message: deleted ? 'Shopify credentials removed' : 'No credentials found'
    });
  } catch (error) {
    console.error('[Customer360] Delete Shopify connection error:', error);
    res.status(500).json({ error: 'Failed to delete Shopify credentials' });
  }
}

// ============================================================================
// Tier Configuration
// ============================================================================

/**
 * GET /api/admin/customers/tiers/config
 * Get tier threshold configuration
 */
async function getTierConfig(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const thresholds = await customer360Service.getTierThresholds(tenantId);

    res.json({ thresholds });
  } catch (error) {
    console.error('[Customer360] Get tier config error:', error);
    res.status(500).json({ error: 'Failed to fetch tier configuration' });
  }
}

/**
 * PATCH /api/admin/customers/tiers/config
 * Update tier threshold configuration
 */
async function updateTierConfig(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { topMinLtv, vipMinLtv, atRiskMaxSentiment } = req.body;

    const updates = {};
    if (typeof topMinLtv === 'number') updates.top_min_ltv = topMinLtv;
    if (typeof vipMinLtv === 'number') updates.vip_min_ltv = vipMinLtv;
    if (typeof atRiskMaxSentiment === 'number') updates.at_risk_max_sentiment = atRiskMaxSentiment;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const thresholds = await customer360Service.updateTierThresholds(tenantId, updates);

    res.json({
      success: true,
      thresholds
    });
  } catch (error) {
    console.error('[Customer360] Update tier config error:', error);
    res.status(500).json({ error: 'Failed to update tier configuration' });
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Stats
  getStats,

  // Customers
  listCustomers,
  getCustomer,
  getCustomerByGladlyId,

  // Events
  getCustomerEvents,

  // Sync
  syncCustomer,

  // Shopify Connection
  getShopifyConnection,
  saveShopifyConnection,
  testShopifyConnection,
  deleteShopifyConnection,

  // Tier Config
  getTierConfig,
  updateTierConfig
};
