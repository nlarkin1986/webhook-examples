/**
 * Admin Portal API Routes
 *
 * REST API for the admin portal:
 * - Authentication (login, signup, me)
 * - Tenant management
 * - Gladly connection management
 * - Agent configuration
 * - Analysis history and stats
 */

const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const authController = require('./controllers/auth');
const tenantsController = require('./controllers/tenants');
const gladlyController = require('./controllers/gladly');
const configController = require('./controllers/config');
const analysisController = require('./controllers/analysis');

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

  return router;
};
