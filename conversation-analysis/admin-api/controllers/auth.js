/**
 * Auth Controller
 *
 * Handles user authentication, signup, and password management.
 */

const db = require('../../db/connection');
const tenantService = require('../../services/tenant-service');
const { jwt, password, logAudit, JWT_EXPIRES_IN } = require('../../middleware/auth');

/**
 * POST /api/admin/auth/signup
 * Create a new tenant and admin user
 */
async function signup(req, res) {
  const { companyName, email, password: plainPassword } = req.body;

  // Validate required fields
  if (!companyName || !email || !plainPassword) {
    return res.status(400).json({ error: 'companyName, email, and password are required' });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate password strength
  if (plainPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if email already exists
    const existingUser = await db.query(
      'SELECT 1 FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Generate slug from company name
    const slug = await tenantService.generateSlug(companyName);

    // Hash password
    const passwordHash = await password.hash(plainPassword);

    // Create tenant and admin user in a transaction
    const result = await db.transaction(async (client) => {
      // Create tenant
      const tenantResult = await client.query(`
        INSERT INTO tenants (name, slug, plan, status)
        VALUES ($1, $2, 'standard', 'active')
        RETURNING id, name, slug, plan, status, created_at
      `, [companyName, slug]);

      const tenant = tenantResult.rows[0];

      // Create admin user
      const userResult = await client.query(`
        INSERT INTO admin_users (tenant_id, email, password_hash, role)
        VALUES ($1, $2, $3, 'admin')
        RETURNING id, email, role, created_at
      `, [tenant.id, email.toLowerCase(), passwordHash]);

      const user = userResult.rows[0];

      return { tenant, user };
    });

    // Generate JWT token
    const token = jwt.sign({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      role: result.user.role
    });

    // Log audit event
    await logAudit({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'tenant_created',
      resourceType: 'tenant',
      resourceId: result.tenant.id,
      details: { companyName, email: result.user.email },
      ipAddress: req.ip
    });

    res.status(201).json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        plan: result.tenant.plan
      }
    });

  } catch (error) {
    console.error('[Auth] Signup error:', error.message);
    res.status(500).json({ error: 'Failed to create account' });
  }
}

/**
 * POST /api/admin/auth/login
 * Authenticate user and return JWT token
 */
async function login(req, res) {
  const { email, password: plainPassword } = req.body;

  if (!email || !plainPassword) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    // Find user by email
    const result = await db.query(`
      SELECT
        au.id,
        au.tenant_id,
        au.email,
        au.password_hash,
        au.role,
        t.name as tenant_name,
        t.slug as tenant_slug,
        t.plan as tenant_plan,
        t.status as tenant_status
      FROM admin_users au
      JOIN tenants t ON au.tenant_id = t.id
      WHERE au.email = $1
    `, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check tenant status
    if (user.tenant_status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    // Verify password
    const isValid = await password.verify(plainPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query(
      'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign({
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role
    });

    // Log audit event
    await logAudit({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user_login',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip
    });

    res.json({
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
        plan: user.tenant_plan
      }
    });

  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
}

/**
 * GET /api/admin/auth/me
 * Get current authenticated user
 */
async function me(req, res) {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    },
    tenant: req.user.tenant
  });
}

/**
 * POST /api/admin/auth/change-password
 * Change user password
 */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    // Get current password hash
    const result = await db.query(
      'SELECT password_hash FROM admin_users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await password.verify(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password and update
    const newHash = await password.hash(newPassword);
    await db.query(
      'UPDATE admin_users SET password_hash = $1 WHERE id = $2',
      [newHash, req.user.id]
    );

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'password_changed',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('[Auth] Change password error:', error.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
}

module.exports = {
  signup,
  login,
  me,
  changePassword
};
