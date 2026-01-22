/**
 * Credential Service
 *
 * Handles secure storage and retrieval of Gladly API credentials
 * using AES-256-GCM encryption.
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
 * Store Gladly credentials for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} credentials - Credential data
 * @param {string} credentials.gladlyHost - Gladly host (e.g., company.gladly.com)
 * @param {string} credentials.gladlyUsername - API user email
 * @param {string} credentials.gladlyApiToken - API token (will be encrypted)
 * @param {string} [credentials.webhookSecret] - Optional Basic Auth secret for webhooks
 * @returns {Promise<object>} Created credential record
 */
async function createCredentials(tenantId, credentials) {
  const { gladlyHost, gladlyUsername, gladlyApiToken, webhookSecret } = credentials;

  // Encrypt the API token
  const { encrypted, iv, tag } = encrypt(gladlyApiToken);

  const result = await db.query(`
    INSERT INTO gladly_credentials (
      tenant_id,
      gladly_host,
      gladly_username,
      gladly_api_token_encrypted,
      gladly_api_token_iv,
      gladly_api_token_tag,
      webhook_secret,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    ON CONFLICT (tenant_id) DO UPDATE SET
      gladly_host = EXCLUDED.gladly_host,
      gladly_username = EXCLUDED.gladly_username,
      gladly_api_token_encrypted = EXCLUDED.gladly_api_token_encrypted,
      gladly_api_token_iv = EXCLUDED.gladly_api_token_iv,
      gladly_api_token_tag = EXCLUDED.gladly_api_token_tag,
      webhook_secret = EXCLUDED.webhook_secret,
      status = 'pending',
      updated_at = NOW()
    RETURNING id, tenant_id, gladly_host, gladly_username, status, created_at, updated_at
  `, [tenantId, gladlyHost, gladlyUsername, encrypted, iv, tag, webhookSecret]);

  return result.rows[0];
}

/**
 * Get credentials for a tenant (decrypts API token)
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object|null>} Credentials with decrypted token or null
 */
async function getCredentials(tenantId) {
  const result = await db.query(`
    SELECT
      id,
      tenant_id,
      gladly_host,
      gladly_username,
      gladly_api_token_encrypted,
      gladly_api_token_iv,
      gladly_api_token_tag,
      webhook_secret,
      status,
      last_verified_at,
      created_at,
      updated_at
    FROM gladly_credentials
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Decrypt the API token
  const gladlyApiToken = decrypt(
    row.gladly_api_token_encrypted,
    row.gladly_api_token_iv,
    row.gladly_api_token_tag
  );

  return {
    id: row.id,
    tenantId: row.tenant_id,
    gladlyHost: row.gladly_host,
    gladlyUsername: row.gladly_username,
    gladlyApiToken,
    webhookSecret: row.webhook_secret,
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
      gladly_host,
      gladly_username,
      status,
      last_verified_at,
      created_at,
      updated_at
    FROM gladly_credentials
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    gladlyHost: row.gladly_host,
    gladlyUsername: row.gladly_username,
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
    UPDATE gladly_credentials
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
    DELETE FROM gladly_credentials WHERE tenant_id = $1
  `, [tenantId]);

  return result.rowCount > 0;
}

/**
 * Generate a secure random webhook secret
 * @returns {string} 32-character hex string
 */
function generateWebhookSecret() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  createCredentials,
  getCredentials,
  getCredentialsMeta,
  updateVerificationStatus,
  deleteCredentials,
  generateWebhookSecret
};
