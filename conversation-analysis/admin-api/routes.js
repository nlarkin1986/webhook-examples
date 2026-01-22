/**
 * Admin Portal API Routes
 *
 * REST API for the admin portal:
 * - Authentication (login, signup, me)
 * - Tenant management
 * - Gladly connection management
 * - Agent configuration
 * - Analysis history and stats
 * - Customer Intelligence (trends, alerts, feedback)
 */

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const authController = require('./controllers/auth');
const tenantsController = require('./controllers/tenants');
const gladlyController = require('./controllers/gladly');
const configController = require('./controllers/config');
const analysisController = require('./controllers/analysis');
const intelligenceController = require('./controllers/intelligence');
const customer360Controller = require('./controllers/customer360');

module.exports = () => {
  const router = express.Router();

  // ============================================================================
  // Authentication Routes (public)
  // ============================================================================

  // POST /api/admin/auth/signup - Create new tenant and admin user
  router.post('/auth/signup', authController.signup);

  // POST /api/admin/auth/login - Authenticate and get JWT token
  router.post('/auth/login', authController.login);

  // GET /api/admin/auth/me - Get current user (requires auth)
  router.get('/auth/me', authenticate, authController.me);

  // POST /api/admin/auth/change-password - Change password (requires auth)
  router.post('/auth/change-password', authenticate, authController.changePassword);

  // ============================================================================
  // Tenant Routes (requires auth)
  // ============================================================================

  // GET /api/admin/tenant - Get current tenant details
  router.get('/tenant', authenticate, tenantsController.getTenant);

  // PATCH /api/admin/tenant - Update tenant details
  router.patch('/tenant', authenticate, authorize('admin'), tenantsController.updateTenant);

  // GET /api/admin/tenant/webhook-url - Get webhook URL for this tenant
  router.get('/tenant/webhook-url', authenticate, tenantsController.getWebhookUrl);

  // ============================================================================
  // Gladly Connection Routes (requires auth)
  // ============================================================================

  // GET /api/admin/gladly/connection - Get connection status
  router.get('/gladly/connection', authenticate, gladlyController.getConnection);

  // POST /api/admin/gladly/connection - Create/update Gladly credentials
  router.post('/gladly/connection', authenticate, authorize('admin'), gladlyController.saveConnection);

  // POST /api/admin/gladly/test - Test Gladly connection
  router.post('/gladly/test', authenticate, authorize('admin'), gladlyController.testConnection);

  // DELETE /api/admin/gladly/connection - Remove Gladly credentials
  router.delete('/gladly/connection', authenticate, authorize('admin'), gladlyController.deleteConnection);

  // GET /api/admin/gladly/topics - List Gladly topics (for mapping UI)
  router.get('/gladly/topics', authenticate, gladlyController.listTopics);

  // ============================================================================
  // Agent Configuration Routes (requires auth)
  // ============================================================================

  // GET /api/admin/config - Get agent configuration
  router.get('/config', authenticate, configController.getConfig);

  // PATCH /api/admin/config - Update agent configuration
  router.patch('/config', authenticate, authorize('admin'), configController.updateConfig);

  // POST /api/admin/config/reset - Reset config to defaults
  router.post('/config/reset', authenticate, authorize('admin'), configController.resetConfig);

  // GET /api/admin/config/models - Get available models
  router.get('/config/models', authenticate, configController.getModels);

  // GET /api/admin/config/tools - Get available tools
  router.get('/config/tools', authenticate, configController.getTools);

  // PATCH /api/admin/config/topic-mappings - Update topic mappings
  router.patch('/config/topic-mappings', authenticate, authorize('admin'), configController.updateTopicMappings);

  // POST /api/admin/config/guided - Save guided prompt builder configuration
  router.post('/config/guided', authenticate, authorize('admin'), configController.saveGuidedConfig);

  // ============================================================================
  // Analysis History Routes (requires auth)
  // ============================================================================

  // GET /api/admin/analysis - List recent analyses
  router.get('/analysis', authenticate, analysisController.listAnalyses);

  // GET /api/admin/analysis/stats - Get analysis statistics
  router.get('/analysis/stats', authenticate, analysisController.getStats);

  // GET /api/admin/analysis/:id - Get specific analysis
  router.get('/analysis/:id', authenticate, analysisController.getAnalysis);

  // ============================================================================
  // Customer Intelligence Routes (requires auth)
  // ============================================================================

  // Dashboard & Summary
  // GET /api/admin/intelligence/summary - Get dashboard summary
  router.get('/intelligence/summary', authenticate, intelligenceController.getSummary);

  // Trends
  // GET /api/admin/intelligence/trends - Get trending/emerging/declining topics
  router.get('/intelligence/trends', authenticate, intelligenceController.getTrends);

  // Products
  // GET /api/admin/intelligence/products - Get product feedback insights
  router.get('/intelligence/products', authenticate, intelligenceController.getProducts);

  // GET /api/admin/intelligence/products/:productId - Get product detail
  router.get('/intelligence/products/:productId', authenticate, intelligenceController.getProductDetail);

  // Geographic
  // GET /api/admin/intelligence/geographic - Get geographic patterns
  router.get('/intelligence/geographic', authenticate, intelligenceController.getGeographic);

  // Alerts
  // GET /api/admin/intelligence/alerts - List alerts
  router.get('/intelligence/alerts', authenticate, intelligenceController.getAlerts);

  // GET /api/admin/intelligence/alerts/:id - Get specific alert
  router.get('/intelligence/alerts/:id', authenticate, intelligenceController.getAlert);

  // POST /api/admin/intelligence/alerts - Create custom alert
  router.post('/intelligence/alerts', authenticate, authorize('admin'), intelligenceController.createCustomAlert);

  // PATCH /api/admin/intelligence/alerts/:id - Update alert status
  router.patch('/intelligence/alerts/:id', authenticate, authorize('admin'), intelligenceController.updateAlert);

  // Feedback
  // GET /api/admin/intelligence/feedback - List feedback items
  router.get('/intelligence/feedback', authenticate, intelligenceController.listFeedback);

  // GET /api/admin/intelligence/feedback/search - Search feedback
  router.get('/intelligence/feedback/search', authenticate, intelligenceController.searchFeedback);

  // Configuration
  // GET /api/admin/intelligence/config - Get intelligence config
  router.get('/intelligence/config', authenticate, intelligenceController.getIntelligenceConfig);

  // PATCH /api/admin/intelligence/config - Update intelligence config
  router.patch('/intelligence/config', authenticate, authorize('admin'), intelligenceController.updateIntelligenceConfig);

  // Manual Operations (admin only)
  // POST /api/admin/intelligence/aggregate - Trigger aggregation
  router.post('/intelligence/aggregate', authenticate, authorize('admin'), intelligenceController.triggerAggregation);

  // POST /api/admin/intelligence/detect-trends - Trigger trend detection
  router.post('/intelligence/detect-trends', authenticate, authorize('admin'), intelligenceController.triggerTrendDetection);

  // ============================================================================
  // Customer 360 Routes (requires auth)
  // ============================================================================

  // Stats
  // GET /api/admin/customers/stats - Get customer 360 dashboard statistics
  router.get('/customers/stats', authenticate, customer360Controller.getStats);

  // Tier Configuration
  // GET /api/admin/customers/tiers/config - Get tier thresholds
  router.get('/customers/tiers/config', authenticate, customer360Controller.getTierConfig);

  // PATCH /api/admin/customers/tiers/config - Update tier thresholds
  router.patch('/customers/tiers/config', authenticate, authorize('admin'), customer360Controller.updateTierConfig);

  // Customer List
  // GET /api/admin/customers - List customers with filtering
  router.get('/customers', authenticate, customer360Controller.listCustomers);

  // Customer by Gladly ID (must come before :id route)
  // GET /api/admin/customers/gladly/:gladlyCustomerId - Get by Gladly ID
  router.get('/customers/gladly/:gladlyCustomerId', authenticate, customer360Controller.getCustomerByGladlyId);

  // Customer Detail
  // GET /api/admin/customers/:id - Get customer 360 profile
  router.get('/customers/:id', authenticate, customer360Controller.getCustomer);

  // Customer Events
  // GET /api/admin/customers/:id/events - Get customer activity stream
  router.get('/customers/:id/events', authenticate, customer360Controller.getCustomerEvents);

  // Customer Sync
  // POST /api/admin/customers/:id/sync - Trigger Shopify sync for customer
  router.post('/customers/:id/sync', authenticate, authorize('admin'), customer360Controller.syncCustomer);

  // ============================================================================
  // Shopify Integration Routes (requires auth)
  // ============================================================================

  // GET /api/admin/shopify/connection - Get Shopify connection status
  router.get('/shopify/connection', authenticate, customer360Controller.getShopifyConnection);

  // POST /api/admin/shopify/connection - Save Shopify credentials
  router.post('/shopify/connection', authenticate, authorize('admin'), customer360Controller.saveShopifyConnection);

  // POST /api/admin/shopify/test - Test Shopify connection
  router.post('/shopify/test', authenticate, authorize('admin'), customer360Controller.testShopifyConnection);

  // DELETE /api/admin/shopify/connection - Remove Shopify credentials
  router.delete('/shopify/connection', authenticate, authorize('admin'), customer360Controller.deleteShopifyConnection);

  return router;
};
