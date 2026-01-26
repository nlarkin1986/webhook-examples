/**
 * Shopify Credential Service
 *
 * Handles secure storage and retrieval of Shopify API credentials
 * using AES-256-GCM encryption. Includes SSRF validation for store URLs.
 */

const crypto = require('crypto');
const db = require('../db/connection');

// Encryption key from environment (must be 32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY;

/**
 * Validate encryption key is configured
 */
function validateEncryptionKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY environment variable is required');
  }

  // Key should be 64 hex characters (32 bytes)
  if (!/^[a-f0-9]{64}$/i.test(ENCRYPTION_KEY)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)');
  }
}

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @returns {object} { encrypted, iv, tag } - All as buffers
 */
function encrypt(plaintext) {
  validateEncryptionKey();

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);  // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const tag = cipher.getAuthTag();

  return { encrypted, iv, tag };
}

/**
 * Decrypt a string using AES-256-GCM
 * @param {Buffer} encrypted - Encrypted data
 * @param {Buffer} iv - Initialization vector
 * @param {Buffer} tag - Authentication tag
 * @returns {string} Decrypted plaintext
 */
function decrypt(encrypted, iv, tag) {
  validateEncryptionKey();

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Validate Shopify store URL to prevent SSRF attacks
 * Only allows *.myshopify.com domains
 *
 * @param {string} storeUrl - Store URL to validate
 * @returns {string} Validated store URL (without protocol)
 * @throws {Error} If URL doesn't match allowed pattern
 */
function validateShopifyStoreUrl(storeUrl) {
  if (!storeUrl || typeof storeUrl !== 'string') {
    throw new Error('Store URL is required');
  }

  // Remove protocol if present
  let cleanUrl = storeUrl.toLowerCase().trim();
  cleanUrl = cleanUrl.replace(/^https?:\/\//, '');
  cleanUrl = cleanUrl.replace(/\/+$/, ''); // Remove trailing slashes

  // SSRF validation: Only allow *.myshopify.com domains
  const pattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
  if (!pattern.test(cleanUrl)) {
    throw new Error('Invalid Shopify store URL. Must be in format: yourstore.myshopify.com');
  }

  // Additional validation: no path or query params
  if (cleanUrl.includes('/') || cleanUrl.includes('?') || cleanUrl.includes('#')) {
    throw new Error('Store URL must not contain paths or query parameters');
  }

  return cleanUrl;
}

/**
 * Store Shopify credentials for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} credentials - Credential data
 * @param {string} credentials.storeUrl - Shopify store URL (e.g., mystore.myshopify.com)
 * @param {string} credentials.accessToken - Shopify Admin API access token
 * @param {string[]} [credentials.scopes] - Optional scopes array
 * @returns {Promise<object>} Created credential record
 */
async function createCredentials(tenantId, credentials) {
  const { storeUrl, accessToken, scopes } = credentials;

  // Validate store URL (SSRF protection)
  const validatedStoreUrl = validateShopifyStoreUrl(storeUrl);

  // Encrypt the access token
  const { encrypted, iv, tag } = encrypt(accessToken);

  const result = await db.query(`
    INSERT INTO shopify_credentials (
      tenant_id,
      store_url,
      access_token_encrypted,
      access_token_iv,
      access_token_tag,
      scopes,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    ON CONFLICT (tenant_id) DO UPDATE SET
      store_url = EXCLUDED.store_url,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      access_token_iv = EXCLUDED.access_token_iv,
      access_token_tag = EXCLUDED.access_token_tag,
      scopes = EXCLUDED.scopes,
      status = 'pending',
      updated_at = NOW()
    RETURNING id, tenant_id, store_url, scopes, status, created_at, updated_at
  `, [
    tenantId,
    validatedStoreUrl,
    encrypted,
    iv,
    tag,
    scopes || ['read_customers', 'read_orders']
  ]);

  return result.rows[0];
}

/**
 * Get credentials for a tenant (decrypts access token)
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object|null>} Credentials with decrypted token or null
 */
async function getCredentials(tenantId) {
  const result = await db.query(`
    SELECT
      id,
      tenant_id,
      store_url,
      access_token_encrypted,
      access_token_iv,
      access_token_tag,
      scopes,
      status,
      last_verified_at,
      created_at,
      updated_at
    FROM shopify_credentials
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Decrypt the access token
  const accessToken = decrypt(
    row.access_token_encrypted,
    row.access_token_iv,
    row.access_token_tag
  );

  return {
    id: row.id,
    tenantId: row.tenant_id,
    storeUrl: row.store_url,
    accessToken,
    scopes: row.scopes,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Get credentials without decrypting (for listing)
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object|null>} Credentials metadata (no token)
 */
async function getCredentialsMeta(tenantId) {
  const result = await db.query(`
    SELECT
      id,
      tenant_id,
      store_url,
      scopes,
      status,
      last_verified_at,
      created_at,
      updated_at
    FROM shopify_credentials
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    storeUrl: row.store_url,
    scopes: row.scopes,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Update credential verification status
 * @param {string} tenantId - Tenant UUID
 * @param {string} status - New status (verified, failed)
 * @returns {Promise<object>} Updated credential record
 */
async function updateVerificationStatus(tenantId, status) {
  const result = await db.query(`
    UPDATE shopify_credentials
    SET status = $2, last_verified_at = NOW()
    WHERE tenant_id = $1
    RETURNING id, tenant_id, status, last_verified_at
  `, [tenantId, status]);

  return result.rows[0];
}

/**
 * Delete credentials for a tenant
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteCredentials(tenantId) {
  const result = await db.query(`
    DELETE FROM shopify_credentials WHERE tenant_id = $1
  `, [tenantId]);

  return result.rowCount > 0;
}

module.exports = {
  validateShopifyStoreUrl,
  encrypt,
  decrypt,
  createCredentials,
  getCredentials,
  getCredentialsMeta,
  updateVerificationStatus,
  deleteCredentials
};
