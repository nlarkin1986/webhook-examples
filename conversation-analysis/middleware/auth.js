/**
 * JWT Authentication Middleware
 *
 * Handles authentication for the admin portal API using JWT tokens.
 */

const crypto = require('crypto');
const db = require('../db/connection');

// JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = 24 * 60 * 60; // 24 hours in seconds

/**
 * Simple JWT implementation (no external dependencies)
 */
const jwt = {
  /**
   * Create a JWT token
   * @param {object} payload - Token payload
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {string} JWT token
   */
  sign(payload, expiresIn = JWT_EXPIRES_IN) {
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);

    const tokenPayload = {
      ...payload,
      iat: now,
      exp: now + expiresIn
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');

    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    return `${base64Header}.${base64Payload}.${signature}`;
  },

  /**
   * Verify and decode a JWT token
   * @param {string} token - JWT token
   * @returns {object} Decoded payload
   * @throws {Error} If token is invalid or expired
   */
  verify(token) {
    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [base64Header, base64Payload, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString());

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Token expired');
    }

    return payload;
  }
};

/**
 * Password hashing using scrypt
 */
const password = {
  /**
   * Hash a password
   * @param {string} plaintext - Plain text password
   * @returns {Promise<string>} Hashed password
   */
  async hash(plaintext) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.scrypt(plaintext, salt, 64, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    return `${salt}:${derivedKey.toString('hex')}`;
  },

  /**
   * Verify a password
   * @param {string} plaintext - Plain text password
   * @param {string} hash - Stored hash
   * @returns {Promise<boolean>} True if password matches
   */
  async verify(plaintext, hash) {
    const [salt, key] = hash.split(':');
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.scrypt(plaintext, salt, 64, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
    return crypto.timingSafeEqual(
      Buffer.from(key, 'hex'),
      derivedKey
    );
  }
};

/**
 * Authentication middleware
 * Verifies JWT token and loads user into request
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token);

    // Load user from database
    const result = await db.query(`
      SELECT
        au.id,
        au.tenant_id,
        au.email,
        au.role,
        t.name as tenant_name,
        t.slug as tenant_slug,
        t.plan as tenant_plan,
        t.status as tenant_status
      FROM admin_users au
      JOIN tenants t ON au.tenant_id = t.id
      WHERE au.id = $1
    `, [payload.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Check tenant status
    if (user.tenant_status !== 'active') {
      return res.status(403).json({ error: 'Tenant is not active' });
    }

    // Inject user into request
    req.user = {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
      tenant: {
        name: user.tenant_name,
        slug: user.tenant_slug,
        plan: user.tenant_plan
      }
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
}

/**
 * Optional authentication middleware
 * Loads user if token is present, but doesn't require it
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    await authenticate(req, res, next);
  } catch {
    next();
  }
}

/**
 * Role-based authorization middleware
 * @param {...string} roles - Allowed roles
 * @returns {Function} Middleware function
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

/**
 * Log an audit event
 * @param {object} params - Audit parameters
 */
async function logAudit({ tenantId, userId, action, resourceType, resourceId, details, ipAddress }) {
  try {
    await db.query(`
      INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [tenantId, userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null, ipAddress]);
  } catch (error) {
    console.error('[Audit] Failed to log audit event:', error.message);
  }
}

module.exports = {
  jwt,
  password,
  authenticate,
  optionalAuth,
  authorize,
  logAudit,
  JWT_EXPIRES_IN
};
