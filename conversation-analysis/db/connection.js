/**
 * PostgreSQL Database Connection with RLS Support
 *
 * Provides a connection pool and helper functions for multi-tenant
 * database operations with Row-Level Security (RLS).
 */

const { Pool } = require('pg');

// Connection pool (initialized lazily)
let pool = null;

/**
 * Get or create the database connection pool
 * @returns {Pool} PostgreSQL connection pool
 */
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,  // Maximum connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err);
    });

    pool.on('connect', () => {
      console.log('[DB] New client connected to pool');
    });
  }
  return pool;
}

/**
 * Execute a query without tenant context (for system operations)
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
async function query(text, params = []) {
  const pool = getPool();
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (process.env.LOG_QUERIES === 'true') {
      console.log(`[DB] Query executed in ${duration}ms: ${text.substring(0, 100)}...`);
    }

    return result;
  } catch (error) {
    console.error('[DB] Query error:', error.message);
    console.error('[DB] Query:', text);
    throw error;
  }
}

/**
 * Execute a query with tenant context (sets RLS)
 * This ensures the query only sees data for the specified tenant.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
async function queryWithTenant(tenantId, text, params = []) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Set the tenant context for RLS
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction with tenant context
 * All queries in the transaction will be scoped to the tenant.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {Function} callback - Async function receiving client
 * @returns {Promise<any>} Transaction result
 */
async function transactionWithTenant(tenantId, callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Set the tenant context for RLS
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction without tenant context (for system operations)
 *
 * @param {Function} callback - Async function receiving client
 * @returns {Promise<any>} Transaction result
 */
async function transaction(callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the connection pool (for graceful shutdown)
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] Connection pool closed');
  }
}

/**
 * Test the database connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW() as now');
    console.log(`[DB] Connection test successful at ${result.rows[0].now}`);
    return true;
  } catch (error) {
    console.error('[DB] Connection test failed:', error.message);
    return false;
  }
}

module.exports = {
  getPool,
  query,
  queryWithTenant,
  transactionWithTenant,
  transaction,
  close,
  testConnection
};
