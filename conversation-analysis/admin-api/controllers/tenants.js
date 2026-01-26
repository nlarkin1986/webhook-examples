/**
 * Tenants Controller
 *
 * Handles tenant management operations.
 */

const tenantService = require('../../services/tenant-service');
const { logAudit } = require('../../middleware/auth');

/**
 * GET /api/admin/tenant
 * Get current tenant details
 */
async function getTenant(req, res) {
  try {
    const tenant = await tenantService.getTenantById(req.user.tenantId);

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at
    });
  } catch (error) {
    console.error('[Tenants] Get tenant error:', error.message);
    res.status(500).json({ error: 'Failed to get tenant' });
  }
}

/**
 * PATCH /api/admin/tenant
 * Update tenant details
 */
async function updateTenant(req, res) {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const tenant = await tenantService.updateTenant(req.user.tenantId, { name });

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'tenant_updated',
      resourceType: 'tenant',
      resourceId: req.user.tenantId,
      details: { name },
      ipAddress: req.ip
    });

    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      updatedAt: tenant.updated_at
    });
  } catch (error) {
    console.error('[Tenants] Update tenant error:', error.message);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
}

/**
 * GET /api/admin/tenant/webhook-url
 * Get the webhook URL for this tenant
 */
async function getWebhookUrl(req, res) {
  const baseUrl = process.env.WEBHOOK_BASE_URL || `https://${req.get('host')}`;
  const webhookUrl = `${baseUrl}/webhook/${req.user.tenant.slug}`;

  res.json({
    webhookUrl,
    slug: req.user.tenant.slug,
    instructions: [
      'Go to Gladly Admin > Settings > Webhooks',
      'Click "Add Webhook"',
      `Enter URL: ${webhookUrl}`,
      'Select events: CONVERSATION/CREATED, CONVERSATION/CLOSED',
      'If you configured a webhook secret, add it as Basic Auth password',
      'Save and test the webhook'
    ]
  });
}

module.exports = {
  getTenant,
  updateTenant,
  getWebhookUrl
};
