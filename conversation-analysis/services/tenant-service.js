/**
 * Tenant Service
 *
 * Handles tenant lifecycle management including creation, lookup,
 * and status management.
 */

const db = require('../db/connection');

/**
 * Create a new tenant
 * @param {object} data - Tenant data
 * @param {string} data.name - Company name
 * @param {string} data.slug - URL-safe identifier (must be unique)
 * @param {string} [data.plan] - Subscription plan (default: 'standard')
 * @returns {Promise<object>} Created tenant
 */
async function createTenant({ name, slug, plan = 'standard' }) {
  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
    throw new Error('Slug must be 3-63 lowercase letters, numbers, or hyphens, starting and ending with alphanumeric');
  }

  const result = await db.query(`
    INSERT INTO tenants (name, slug, plan, status)
    VALUES ($1, $2, $3, 'active')
    RETURNING id, name, slug, plan, status, created_at, updated_at
  `, [name, slug, plan]);

  return result.rows[0];
}

/**
 * Get tenant by ID
 * @param {string} id - Tenant UUID
 * @returns {Promise<object|null>} Tenant or null
 */
async function getTenantById(id) {
  const result = await db.query(`
    SELECT id, name, slug, plan, status, created_at, updated_at
    FROM tenants
    WHERE id = $1
  `, [id]);

  return result.rows[0] || null;
}

/**
 * Get tenant by slug (used for webhook routing)
 * @param {string} slug - Tenant slug
 * @returns {Promise<object|null>} Tenant or null
 */
async function getTenantBySlug(slug) {
  const result = await db.query(`
    SELECT id, name, slug, plan, status, created_at, updated_at
    FROM tenants
    WHERE slug = $1
  `, [slug]);

  return result.rows[0] || null;
}

/**
 * Get tenant by slug (only active tenants, for webhook processing)
 * @param {string} slug - Tenant slug
 * @returns {Promise<object|null>} Active tenant or null
 */
async function getActiveTenantBySlug(slug) {
  const result = await db.query(`
    SELECT id, name, slug, plan, status, created_at, updated_at
    FROM tenants
    WHERE slug = $1 AND status = 'active'
  `, [slug]);

  return result.rows[0] || null;
}

/**
 * Update tenant details
 * @param {string} id - Tenant UUID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated tenant
 */
async function updateTenant(id, updates) {
  const allowedFields = ['name', 'plan', 'status'];
  const setClause = [];
  const values = [id];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      values.push(value);
      setClause.push(`${key} = $${values.length}`);
    }
  }

  if (setClause.length === 0) {
    throw new Error('No valid fields to update');
  }

  const result = await db.query(`
    UPDATE tenants
    SET ${setClause.join(', ')}
    WHERE id = $1
    RETURNING id, name, slug, plan, status, created_at, updated_at
  `, values);

  return result.rows[0];
}

/**
 * Soft-delete (suspend) a tenant
 * @param {string} id - Tenant UUID
 * @returns {Promise<object>} Updated tenant
 */
async function suspendTenant(id) {
  return updateTenant(id, { status: 'suspended' });
}

/**
 * Reactivate a suspended tenant
 * @param {string} id - Tenant UUID
 * @returns {Promise<object>} Updated tenant
 */
async function reactivateTenant(id) {
  return updateTenant(id, { status: 'active' });
}

/**
 * Permanently delete a tenant and all associated data
 * (CASCADE will handle credentials, configs, results)
 * @param {string} id - Tenant UUID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteTenant(id) {
  const result = await db.query(`
    DELETE FROM tenants WHERE id = $1
  `, [id]);

  return result.rowCount > 0;
}

/**
 * List all tenants with pagination
 * @param {object} options - Query options
 * @param {number} [options.limit] - Max results (default: 50)
 * @param {number} [options.offset] - Offset for pagination
 * @param {string} [options.status] - Filter by status
 * @returns {Promise<object>} { tenants, total }
 */
async function listTenants({ limit = 50, offset = 0, status } = {}) {
  let whereClause = '';
  const values = [limit, offset];

  if (status) {
    values.push(status);
    whereClause = `WHERE status = $${values.length}`;
  }

  const countResult = await db.query(`
    SELECT COUNT(*) as total FROM tenants ${whereClause}
  `, status ? [status] : []);

  const result = await db.query(`
    SELECT id, name, slug, plan, status, created_at, updated_at
    FROM tenants
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, values);

  return {
    tenants: result.rows,
    total: parseInt(countResult.rows[0].total, 10)
  };
}

/**
 * Check if a slug is available
 * @param {string} slug - Proposed slug
 * @returns {Promise<boolean>} True if available
 */
async function isSlugAvailable(slug) {
  const result = await db.query(`
    SELECT 1 FROM tenants WHERE slug = $1
  `, [slug]);

  return result.rows.length === 0;
}

/**
 * Generate a slug from a company name
 * @param {string} name - Company name
 * @returns {Promise<string>} Unique slug
 */
async function generateSlug(name) {
  // Convert to lowercase, replace spaces/special chars with hyphens
  let baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  // Ensure minimum length
  if (baseSlug.length < 3) {
    baseSlug = baseSlug.padEnd(3, '0');
  }

  // Check availability and add suffix if needed
  let slug = baseSlug;
  let counter = 1;

  while (!(await isSlugAvailable(slug))) {
    slug = `${baseSlug}-${counter}`;
    counter++;

    if (counter > 100) {
      throw new Error('Unable to generate unique slug');
    }
  }

  return slug;
}

module.exports = {
  createTenant,
  getTenantById,
  getTenantBySlug,
  getActiveTenantBySlug,
  updateTenant,
  suspendTenant,
  reactivateTenant,
  deleteTenant,
  listTenants,
  isSlugAvailable,
  generateSlug
};
