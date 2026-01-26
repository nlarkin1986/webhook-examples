/**
 * Gladly Controller
 *
 * Handles Gladly connection management and verification.
 */

const credentialService = require('../../services/credential-service');
const { createGladlyClient, testConnection } = require('../../services/gladly-client');
const { logAudit } = require('../../middleware/auth');

/**
 * GET /api/admin/gladly/connection
 * Get current Gladly connection status (without exposing token)
 */
async function getConnection(req, res) {
  try {
    const credentials = await credentialService.getCredentialsMeta(req.user.tenantId);

    if (!credentials) {
      return res.json({
        connected: false,
        message: 'No Gladly connection configured'
      });
    }

    res.json({
      connected: true,
      gladlyHost: credentials.gladlyHost,
      gladlyUsername: credentials.gladlyUsername,
      status: credentials.status,
      lastVerifiedAt: credentials.lastVerifiedAt,
      hasWebhookSecret: !!credentials.webhookSecret
    });
  } catch (error) {
    console.error('[Gladly] Get connection error:', error.message);
    res.status(500).json({ error: 'Failed to get connection status' });
  }
}

/**
 * POST /api/admin/gladly/connection
 * Create or update Gladly credentials
 */
async function saveConnection(req, res) {
  const { gladlyHost, gladlyUsername, gladlyApiToken, webhookSecret } = req.body;

  if (!gladlyHost || !gladlyUsername || !gladlyApiToken) {
    return res.status(400).json({
      error: 'gladlyHost, gladlyUsername, and gladlyApiToken are required'
    });
  }

  // Validate host format
  const cleanHost = gladlyHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+\.gladly\.com$/.test(cleanHost) && !/^[a-z0-9-]+\.gladly\.qa$/.test(cleanHost)) {
    return res.status(400).json({
      error: 'gladlyHost must be a valid Gladly domain (e.g., company.gladly.com)'
    });
  }

  try {
    // Generate webhook secret if not provided
    const secret = webhookSecret || credentialService.generateWebhookSecret();

    // Store credentials
    const credential = await credentialService.createCredentials(req.user.tenantId, {
      gladlyHost: cleanHost,
      gladlyUsername,
      gladlyApiToken,
      webhookSecret: secret
    });

    // Test the connection
    const testResult = await testConnection({
      gladlyHost: cleanHost,
      gladlyUsername,
      gladlyApiToken
    });

    // Update verification status
    await credentialService.updateVerificationStatus(
      req.user.tenantId,
      testResult.success ? 'verified' : 'failed'
    );

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'gladly_credentials_saved',
      resourceType: 'credential',
      resourceId: credential.id,
      details: { gladlyHost: cleanHost, gladlyUsername, verified: testResult.success },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      gladlyHost: cleanHost,
      gladlyUsername,
      status: testResult.success ? 'verified' : 'failed',
      webhookSecret: secret,
      testResult: {
        success: testResult.success,
        organization: testResult.organization?.name,
        error: testResult.error
      }
    });

  } catch (error) {
    console.error('[Gladly] Save connection error:', error.message);
    res.status(500).json({ error: 'Failed to save connection' });
  }
}

/**
 * POST /api/admin/gladly/test
 * Test Gladly connection with current credentials
 */
async function testConnectionEndpoint(req, res) {
  try {
    const credentials = await credentialService.getCredentials(req.user.tenantId);

    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'No Gladly connection configured'
      });
    }

    const result = await testConnection(credentials);

    // Update verification status
    await credentialService.updateVerificationStatus(
      req.user.tenantId,
      result.success ? 'verified' : 'failed'
    );

    res.json({
      success: result.success,
      organization: result.organization?.name,
      error: result.error
    });

  } catch (error) {
    console.error('[Gladly] Test connection error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * DELETE /api/admin/gladly/connection
 * Remove Gladly credentials
 */
async function deleteConnection(req, res) {
  try {
    const deleted = await credentialService.deleteCredentials(req.user.tenantId);

    if (!deleted) {
      return res.status(404).json({ error: 'No connection to delete' });
    }

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'gladly_credentials_deleted',
      resourceType: 'credential',
      ipAddress: req.ip
    });

    res.json({ message: 'Connection removed successfully' });

  } catch (error) {
    console.error('[Gladly] Delete connection error:', error.message);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
}

/**
 * GET /api/admin/gladly/topics
 * List Gladly topics (for topic mapping UI)
 */
async function listTopics(req, res) {
  try {
    const credentials = await credentialService.getCredentials(req.user.tenantId);

    if (!credentials) {
      return res.status(404).json({ error: 'No Gladly connection configured' });
    }

    const client = createGladlyClient(credentials);
    const response = await client.listTopics();

    // Transform topics for UI
    const topics = response.data.map(topic => ({
      id: topic.id,
      name: topic.name,
      disabled: topic.disabled,
      parentId: topic.parentId
    }));

    // Sort by name
    topics.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ topics });

  } catch (error) {
    console.error('[Gladly] List topics error:', error.message);
    res.status(500).json({ error: 'Failed to list topics' });
  }
}

module.exports = {
  getConnection,
  saveConnection,
  testConnection: testConnectionEndpoint,
  deleteConnection,
  listTopics
};
