/**
 * Tenant Context Middleware
 *
 * Extracts tenant from URL slug, loads credentials and config,
 * and injects tenant context into the request for downstream handlers.
 */

const tenantService = require('../services/tenant-service');
const credentialService = require('../services/credential-service');
const configService = require('../services/config-service');
const { createGladlyClient } = require('../services/gladly-client');

/**
 * Format timestamp for logging
 * @returns {string}
 */
function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Tenant context middleware for webhook routes
 *
 * Expects req.params.tenantSlug to be set by the route.
 * Loads tenant, credentials, and config, then creates a Gladly client.
 *
 * Sets req.tenant with:
 * - id, name, slug, plan, status
 * - credentials (decrypted)
 * - config (agent settings)
 * - gladlyClient (ready-to-use API client)
 */
async function tenantContext(req, res, next) {
  const timestamp = formatTimestamp();
  const tenantSlug = req.params.tenantSlug;

  if (!tenantSlug) {
    console.log(`[${timestamp}] Tenant context: missing slug in request`);
    return res.status(400).json({ error: 'Missing tenant identifier' });
  }

  try {
    // Load tenant
    const tenant = await tenantService.getActiveTenantBySlug(tenantSlug);

    if (!tenant) {
      console.log(`[${timestamp}] Tenant context: tenant not found for slug '${tenantSlug}'`);
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Load credentials
    const credentials = await credentialService.getCredentials(tenant.id);

    if (!credentials) {
      console.log(`[${timestamp}] Tenant context: no credentials for tenant '${tenantSlug}'`);
      return res.status(503).json({ error: 'Tenant not configured' });
    }

    if (credentials.status !== 'verified') {
      console.log(`[${timestamp}] Tenant context: credentials not verified for tenant '${tenantSlug}' (status: ${credentials.status})`);
      // Allow processing but log warning
      console.warn(`[${timestamp}] WARNING: Processing webhook for tenant with unverified credentials`);
    }

    // Load agent config
    const config = await configService.getConfig(tenant.id);

    // Create tenant-specific Gladly client
    const gladlyClient = createGladlyClient(credentials);

    // Inject tenant context into request
    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      credentials: {
        gladlyHost: credentials.gladlyHost,
        webhookSecret: credentials.webhookSecret,
        status: credentials.status
      },
      config,
      gladlyClient
    };

    console.log(`[${timestamp}] Tenant context loaded for '${tenantSlug}' (plan: ${tenant.plan})`);
    next();

  } catch (error) {
    console.error(`[${timestamp}] Tenant context error:`, error.message);
    return res.status(500).json({ error: 'Failed to load tenant context' });
  }
}

/**
 * Verify webhook Basic Auth against tenant's webhook secret
 *
 * This middleware should be used AFTER tenantContext.
 * It validates the Authorization header against the tenant's configured webhook secret.
 */
function verifyTenantWebhook(req, res, next) {
  const timestamp = formatTimestamp();

  // Allow PING requests through without verification
  if (req.body && req.body.type === 'PING') {
    return next();
  }

  const tenant = req.tenant;
  if (!tenant) {
    console.log(`[${timestamp}] Webhook auth: missing tenant context`);
    return res.status(500).json({ error: 'Tenant context not loaded' });
  }

  const webhookSecret = tenant.credentials?.webhookSecret;

  // If no webhook secret configured, skip verification
  if (!webhookSecret) {
    console.log(`[${timestamp}] Webhook auth: no secret configured for tenant '${tenant.slug}', skipping`);
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log(`[${timestamp}] Webhook auth failed for '${tenant.slug}': missing Basic auth header`);
    return res.status(401).json({ error: 'Authentication required' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  const [user, pass] = credentials.split(':');

  // Webhook secret format: "user:pass" - extract the password part
  // Or it could just be a token used as the password with any username
  if (pass !== webhookSecret && credentials !== webhookSecret) {
    console.log(`[${timestamp}] Webhook auth failed for '${tenant.slug}': invalid credentials`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  console.log(`[${timestamp}] Webhook auth successful for '${tenant.slug}'`);
  next();
}

/**
 * Verify that webhook is from the correct Gladly host
 *
 * Compares the Gladly host from the webhook payload with the tenant's registered host.
 */
function verifyGladlyHost(req, res, next) {
  const timestamp = formatTimestamp();
  const tenant = req.tenant;

  // Skip for PING events
  if (req.body?.type === 'PING') {
    return next();
  }

  // Extract host from webhook content if available
  const webhookHost = req.headers['x-gladly-host'] || req.body?.gladlyHost;

  if (webhookHost && tenant.credentials.gladlyHost) {
    const expectedHost = tenant.credentials.gladlyHost.toLowerCase().replace(/^https?:\/\//, '');
    const actualHost = webhookHost.toLowerCase().replace(/^https?:\/\//, '');

    if (actualHost !== expectedHost) {
      console.log(`[${timestamp}] Host mismatch for '${tenant.slug}': expected ${expectedHost}, got ${actualHost}`);
      return res.status(403).json({ error: 'Host mismatch' });
    }
  }

  next();
}

module.exports = {
  tenantContext,
  verifyTenantWebhook,
  verifyGladlyHost
};
