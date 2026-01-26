#!/usr/bin/env node
/**
 * Database seed script for Ulta Beauty demo data
 *
 * Creates realistic beauty retail customer experience data for demos.
 *
 * Usage:
 *   npm run seed              # Create demo data
 *   npm run seed:clean        # Remove demo data
 *   npm run seed:verify       # Check if demo tenant exists
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { faker } = require('@faker-js/faker');
const db = require('./connection');

// ============ CONFIGURATION ============
const CONFIG = {
  tenant: {
    name: 'Ulta Beauty Demo',
    slug: 'ulta-demo',
    plan: 'enterprise'
  },
  admin: {
    email: process.env.DEMO_ADMIN_EMAIL || 'demo@ulta-demo.local',
    password: process.env.DEMO_ADMIN_PASSWORD
  },
  volumes: {
    feedbackItems: parseInt(process.env.SEED_FEEDBACK_COUNT || '500', 10),
    daysOfHistory: 60,
    alertsCount: 8
  },
  scenarioDistribution: {
    orderFulfillment: 35,
    productIssues: 25,
    loyaltyRewards: 20,
    productAdvice: 15,
    accountIssues: 5
  },
  stateDistribution: {
    CA: 15, TX: 10, FL: 8, NY: 7, IL: 6, PA: 5, OH: 5,
    GA: 4, NC: 4, MI: 4, NJ: 4, VA: 3, AZ: 3, WA: 3
  },
  carriers: {
    FedEx: 40,
    USPS: 30,
    UPS: 25,
    OnTrac: 5
  },
  // Allowed database hosts (production protection)
  allowedHosts: ['localhost', '127.0.0.1', 'db-dev', 'db-staging', 'postgres']
};

// ============ FIXTURES ============
const PRODUCTS = [
  { id: 'PROD-001', title: 'Hydrating Facial Serum', category: 'skincare', price: 52 },
  { id: 'PROD-002', title: 'Velvet Matte Lipstick', category: 'makeup', price: 23 },
  { id: 'PROD-003', title: 'Repair Hair Mask', category: 'haircare', price: 42 },
  { id: 'PROD-004', title: 'Vitamin C Brightening Cream', category: 'skincare', price: 48 },
  { id: 'PROD-005', title: 'Long-Wear Foundation', category: 'makeup', price: 38 },
  { id: 'PROD-006', title: 'Volumizing Mascara', category: 'makeup', price: 25 },
  { id: 'PROD-007', title: 'Hydrating Lip Gloss', category: 'makeup', price: 18 },
  { id: 'PROD-008', title: 'Anti-Aging Night Cream', category: 'skincare', price: 65 },
  { id: 'PROD-009', title: 'Smoothing Shampoo', category: 'haircare', price: 28 },
  { id: 'PROD-010', title: 'Argan Oil Treatment', category: 'haircare', price: 32 },
  { id: 'PROD-011', title: 'Setting Spray', category: 'makeup', price: 22 },
  { id: 'PROD-012', title: 'Exfoliating Scrub', category: 'skincare', price: 35 },
  { id: 'PROD-013', title: 'Brow Pencil', category: 'makeup', price: 19 },
  { id: 'PROD-014', title: 'Retinol Serum', category: 'skincare', price: 58 },
  { id: 'PROD-015', title: 'Heat Protection Spray', category: 'haircare', price: 24 },
  { id: 'PROD-016', title: 'Eyeshadow Palette', category: 'makeup', price: 45 },
  { id: 'PROD-017', title: 'Hydrating Toner', category: 'skincare', price: 28 },
  { id: 'PROD-018', title: 'Color-Protecting Conditioner', category: 'haircare', price: 26 },
  { id: 'PROD-019', title: 'Contour Kit', category: 'makeup', price: 42 },
  { id: 'PROD-020', title: 'Sunscreen SPF 50', category: 'skincare', price: 32 },
  { id: 'PROD-021', title: 'Curl Defining Cream', category: 'haircare', price: 22 },
  { id: 'PROD-022', title: 'Blush Palette', category: 'makeup', price: 35 },
  { id: 'PROD-023', title: 'Micellar Water', category: 'skincare', price: 15 },
  { id: 'PROD-024', title: 'Dry Shampoo', category: 'haircare', price: 18 },
  { id: 'PROD-025', title: 'Liquid Highlighter', category: 'makeup', price: 28 },
  { id: 'PROD-026', title: 'Eye Cream', category: 'skincare', price: 45 },
  { id: 'PROD-027', title: 'Leave-In Conditioner', category: 'haircare', price: 20 },
  { id: 'PROD-028', title: 'Primer', category: 'makeup', price: 30 },
  { id: 'PROD-029', title: 'Face Mist', category: 'skincare', price: 22 },
  { id: 'PROD-030', title: 'Texturizing Spray', category: 'haircare', price: 24 }
];

const TOPICS = [
  { topic: 'Shipping & Delivery', subtopics: ['Late Delivery', 'Damaged Package', 'Lost Package', 'Wrong Item', 'Tracking Issues'] },
  { topic: 'BOPIS', subtopics: ['Order Not Ready', 'Long Wait', 'Item Unavailable', 'Store Location', 'Pickup Window'] },
  { topic: 'Product Quality', subtopics: ['Allergic Reaction', 'Shade Mismatch', 'Defective', 'Expired Product', 'Texture Issue'] },
  { topic: 'Rewards & Points', subtopics: ['Missing Points', 'Birthday Gift', 'Coupon Issues', 'Tier Status', 'Point Expiration'] },
  { topic: 'Returns & Exchanges', subtopics: ['Return Policy', 'Refund Status', 'Exchange Request', 'Receipt Issue', 'Restocking'] }
];

// CRITICAL: Use 'geographic_cluster' not 'geographic_anomaly' (schema CHECK constraint)
const ALERT_SCENARIOS = [
  { type: 'product_issue', severity: 'critical', status: 'open', title: 'Allergic reactions spike: Vitamin C Brightening Cream' },
  { type: 'geographic_cluster', severity: 'high', status: 'open', title: 'CA delivery delays +340% this week' },
  { type: 'trending_topic', severity: 'high', status: 'open', title: 'Points not posting after purchase +85%' },
  { type: 'product_issue', severity: 'medium', status: 'acknowledged', title: 'Shade mismatch complaints: Long-Wear Foundation' },
  { type: 'trending_topic', severity: 'medium', status: 'acknowledged', title: 'BOPIS wait times exceeding 15 minutes' },
  { type: 'geographic_cluster', severity: 'medium', status: 'resolved', title: 'TX heat damage resolved - carrier contacted' },
  { type: 'product_issue', severity: 'low', status: 'resolved', title: 'Hydrating Serum packaging leaks fixed' },
  { type: 'trending_topic', severity: 'low', status: 'dismissed', title: 'App login mentions (seasonal spike - false positive)' }
];

// ============ UTILITIES ============
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function selectWeighted(distribution) {
  const entries = Object.entries(distribution);
  const total = entries.reduce((sum, [_, weight]) => sum + weight, 0);
  let random = Math.random() * total;
  for (const [key, weight] of entries) {
    random -= weight;
    if (random <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function generateDateInRange(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(Math.floor(Math.random() * 14) + 8); // 8am-10pm
  date.setMinutes(Math.floor(Math.random() * 60));
  return date.toISOString();
}

// ============ ENVIRONMENT VALIDATION ============
function validateEnvironment() {
  // Explicit production block (defense in depth)
  if (process.env.NODE_ENV === 'production') {
    console.error('\n!!! BLOCKED !!!\n');
    console.error('Seed script cannot run in production environment.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Use hostname allowlist for production protection
  try {
    const url = new URL(dbUrl);
    // Use exact match or suffix match instead of includes()
    const isAllowed = CONFIG.allowedHosts.some(host =>
      url.hostname === host || url.hostname.endsWith('.' + host)
    );
    if (!isAllowed) {
      console.error(`\n!!! BLOCKED !!!\n`);
      console.error(`Database host '${url.hostname}' is not in allowed list.`);
      console.error(`Allowed hosts: ${CONFIG.allowedHosts.join(', ')}`);
      process.exit(1);
    }
  } catch (e) {
    // URL parsing failed - log warning but allow (likely local connection string)
    console.warn('[SEED] Warning: Could not parse DATABASE_URL as URL, skipping host validation');
  }

  // Require --force for staging
  if (process.env.NODE_ENV === 'staging' && !process.argv.includes('--force')) {
    throw new Error('Staging seed requires --force flag');
  }

  // Generate password if not provided
  if (!CONFIG.admin.password) {
    CONFIG.admin.password = faker.internet.password({ length: 16, memorable: false });
    console.log(`\n[SEED] Generated demo password: ${CONFIG.admin.password}\n`);
  }
}

// ============ GENERATORS ============
function generateAnalysisResult(tenantId, conversationId, customerId, date) {
  const sentiment = faker.number.float({ min: -1, max: 1, fractionDigits: 2 });
  const topic = pick(TOPICS);

  return {
    tenant_id: tenantId,
    gladly_customer_id: customerId,
    gladly_conversation_id: conversationId,
    event_type: 'CONVERSATION/CLOSED',
    sentiment: JSON.stringify({
      score: sentiment,
      label: sentiment > 0.2 ? 'positive' : sentiment < -0.2 ? 'negative' : 'neutral',
      confidence: faker.number.float({ min: 0.7, max: 1, fractionDigits: 2 }),
      trajectory: pick(['improving', 'stable', 'declining'])
    }),
    intent: JSON.stringify({
      primary_intent: pick(['returns', 'billing', 'product_inquiry', 'complaint', 'praise']),
      detected_topics: [topic.topic]
    }),
    summary: faker.lorem.sentence(),
    success: true,
    analyzed_at: date
  };
}

function generateFeedbackItem(tenantId, analysisResultId, conversationId, customerId, date, scenarioType) {
  const product = pick(PRODUCTS);
  const topic = pick(TOPICS);
  const baseSentiment = scenarioType === 'productAdvice' ? 0.2 : -0.4;

  // Clamp sentiment to valid range [-1, 1]
  const sentiment = Math.max(-1, Math.min(1, baseSentiment + (Math.random() * 0.4 - 0.2)));
  const state = selectWeighted(CONFIG.stateDistribution);

  // Map scenario type to issue category
  const issueCategory =
    scenarioType === 'orderFulfillment' ? 'shipping' :
    scenarioType === 'productIssues' ? 'product_quality' :
    scenarioType === 'loyaltyRewards' ? 'billing' :
    scenarioType === 'accountIssues' ? 'account' : 'service';

  return {
    tenant_id: tenantId,
    analysis_result_id: analysisResultId,
    conversation_id: conversationId,
    customer_id: customerId,
    analyzed_at: date,
    shopify_product_id: product.id,
    product_title: product.title,
    product_link_method: 'pattern',
    issue_category: issueCategory,
    issue_subcategory: pick(topic.subtopics),
    issue_severity: faker.number.int({ min: 1, max: 5 }),
    is_complaint: sentiment < 0,
    is_praise: sentiment > 0.5,
    sentiment_score: sentiment,
    sentiment_label: sentiment > 0.2 ? 'positive' : sentiment < -0.2 ? 'negative' : 'neutral',
    customer_state: state,
    customer_city: faker.location.city(),
    customer_zip_prefix: faker.location.zipCode().substring(0, 3),
    shipping_carrier: scenarioType === 'orderFulfillment' ? selectWeighted(CONFIG.carriers) : null,
    topics: JSON.stringify([{
      topic: topic.topic,
      subtopic: pick(topic.subtopics),
      sentiment: sentiment,
      confidence: faker.number.float({ min: 0.7, max: 1, fractionDigits: 2 })
    }]),
    churn_risk: sentiment < -0.5 ? 'high' : sentiment < 0 ? 'medium' : 'low',
    churn_indicators: JSON.stringify(sentiment < -0.5 ? ['negative_sentiment', 'repeat_contact'] : []),
    raw_extraction: JSON.stringify({
      customer_profile: {
        loyalty_tier: pick(['Member', 'Platinum', 'Diamond']),
        skin_type: pick(['oily', 'dry', 'combination', 'sensitive', 'normal'])
      }
    })
  };
}

// ============ MAIN SEED FUNCTION ============
async function seed() {
  console.log('[SEED] Starting database seed...');
  const startTime = Date.now();

  validateEnvironment();

  // Set faker seed for reproducibility
  faker.seed(42);

  // Phase 1: Delete existing demo tenant (CASCADE cleans up all related data)
  console.log('[SEED] Cleaning existing demo data...');
  await db.query('DELETE FROM tenants WHERE slug = $1', [CONFIG.tenant.slug]);

  // Phase 2: Create tenant (no RLS on tenants table)
  console.log('[SEED] Creating demo tenant...');
  const tenantResult = await db.query(`
    INSERT INTO tenants (name, slug, plan, status)
    VALUES ($1, $2, $3, 'active')
    RETURNING id
  `, [CONFIG.tenant.name, CONFIG.tenant.slug, CONFIG.tenant.plan]);
  const tenantId = tenantResult.rows[0].id;
  console.log(`[SEED] Created tenant: ${tenantId}`);

  // Phase 3: Create admin user (with RLS context)
  await db.transactionWithTenant(tenantId, async (client) => {
    // Use the same password hashing as the auth middleware (scrypt, not bcrypt)
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.scrypt(CONFIG.admin.password, salt, 64, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const passwordHash = `${salt}:${derivedKey.toString('hex')}`;

    await client.query(`
      INSERT INTO admin_users (tenant_id, email, password_hash, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [tenantId, CONFIG.admin.email, passwordHash]);
    console.log('[SEED] Created admin user');
  });

  // Phase 4: Generate and insert data with proper FK order
  await db.transactionWithTenant(tenantId, async (client) => {
    // Determine scenario for each item based on distribution
    const scenarios = [];
    const dist = CONFIG.scenarioDistribution;
    const total = CONFIG.volumes.feedbackItems;
    Object.entries(dist).forEach(([scenario, pct]) => {
      const count = Math.round(total * pct / 100);
      for (let i = 0; i < count; i++) scenarios.push(scenario);
    });
    // Shuffle scenarios
    for (let i = scenarios.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]];
    }

    // Generate data pairs
    console.log(`[SEED] Generating ${CONFIG.volumes.feedbackItems} records...`);
    const dataPairs = [];
    for (let i = 0; i < CONFIG.volumes.feedbackItems; i++) {
      const daysAgo = Math.floor(Math.random() * CONFIG.volumes.daysOfHistory);
      const date = generateDateInRange(daysAgo);
      const conversationId = `conv-${faker.string.uuid()}`;
      const customerId = `cust-${faker.string.nanoid(10)}`;
      const scenario = scenarios[i] || 'productAdvice';

      dataPairs.push({
        analysisResult: generateAnalysisResult(tenantId, conversationId, customerId, date),
        feedbackMeta: { conversationId, customerId, date, scenario }
      });
    }

    // Insert analysis_results FIRST (FK target)
    console.log('[SEED] Inserting analysis_results...');
    const insertedAnalysisIds = [];

    for (let i = 0; i < dataPairs.length; i++) {
      const ar = dataPairs[i].analysisResult;
      const result = await client.query(`
        INSERT INTO analysis_results (tenant_id, gladly_customer_id, gladly_conversation_id, event_type, sentiment, intent, summary, success, analyzed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [ar.tenant_id, ar.gladly_customer_id, ar.gladly_conversation_id, ar.event_type, ar.sentiment, ar.intent, ar.summary, ar.success, ar.analyzed_at]);
      insertedAnalysisIds.push(result.rows[0].id);

      if ((i + 1) % 100 === 0) {
        console.log(`[SEED] Inserted ${i + 1}/${dataPairs.length} analysis_results`);
      }
    }
    console.log(`[SEED] Inserted ${insertedAnalysisIds.length} analysis_results`);

    // Insert feedback_items SECOND (with FK refs to analysis_results)
    console.log('[SEED] Inserting feedback_items...');

    for (let i = 0; i < dataPairs.length; i++) {
      const analysisResultId = insertedAnalysisIds[i];
      const meta = dataPairs[i].feedbackMeta;
      const fb = generateFeedbackItem(tenantId, analysisResultId, meta.conversationId, meta.customerId, meta.date, meta.scenario);

      await client.query(`
        INSERT INTO feedback_items (
          tenant_id, analysis_result_id, conversation_id, customer_id, analyzed_at,
          shopify_product_id, product_title, product_link_method,
          issue_category, issue_subcategory, issue_severity, is_complaint, is_praise,
          sentiment_score, sentiment_label, customer_state, customer_city, customer_zip_prefix,
          shipping_carrier, topics, churn_risk, churn_indicators, raw_extraction
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      `, [
        fb.tenant_id, fb.analysis_result_id, fb.conversation_id, fb.customer_id, fb.analyzed_at,
        fb.shopify_product_id, fb.product_title, fb.product_link_method,
        fb.issue_category, fb.issue_subcategory, fb.issue_severity, fb.is_complaint, fb.is_praise,
        fb.sentiment_score, fb.sentiment_label, fb.customer_state, fb.customer_city, fb.customer_zip_prefix,
        fb.shipping_carrier, fb.topics, fb.churn_risk, fb.churn_indicators, fb.raw_extraction
      ]);

      if ((i + 1) % 100 === 0) {
        console.log(`[SEED] Inserted ${i + 1}/${dataPairs.length} feedback_items`);
      }
    }
    console.log(`[SEED] Inserted ${dataPairs.length} feedback_items`);

    // Insert intelligence_alerts
    console.log('[SEED] Inserting intelligence_alerts...');
    for (const alert of ALERT_SCENARIOS) {
      await client.query(`
        INSERT INTO intelligence_alerts (tenant_id, alert_type, severity, status, title, description)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [tenantId, alert.type, alert.severity, alert.status, alert.title, faker.lorem.sentences(2)]);
    }
    console.log(`[SEED] Inserted ${ALERT_SCENARIOS.length} alerts`);
  });

  // Phase 5: Refresh materialized view
  console.log('[SEED] Refreshing materialized view...');
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY feedback_topics_expanded');
    console.log('[SEED] Materialized view refreshed');
  } catch (e) {
    // View may not exist or be empty
    console.log('[SEED] Materialized view refresh skipped (may not exist or be empty)');
  }

  // Phase 6: Verification
  console.log('[SEED] Verifying data integrity...');
  const verification = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM feedback_items fi JOIN tenants t ON fi.tenant_id = t.id WHERE t.slug = $1) as feedback_count,
      (SELECT COUNT(*) FROM analysis_results ar JOIN tenants t ON ar.tenant_id = t.id WHERE t.slug = $1) as analysis_count,
      (SELECT COUNT(*) FROM intelligence_alerts ia JOIN tenants t ON ia.tenant_id = t.id WHERE t.slug = $1) as alert_count
  `, [CONFIG.tenant.slug]);

  const { feedback_count, analysis_count, alert_count } = verification.rows[0];
  console.log(`[SEED] Verification: ${feedback_count} feedback items, ${analysis_count} analysis results, ${alert_count} alerts`);

  const elapsed = Date.now() - startTime;
  console.log(`\n[SEED] Complete in ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`[SEED] Demo tenant slug: ${CONFIG.tenant.slug}`);
  console.log(`[SEED] Demo credentials: ${CONFIG.admin.email}`);
  if (!process.env.DEMO_ADMIN_PASSWORD) {
    console.log(`[SEED] Demo password was auto-generated (see above)`);
  }
}

// ============ UNSEED FUNCTION ============
async function unseed() {
  console.log('[UNSEED] Removing demo data...');
  const result = await db.query('DELETE FROM tenants WHERE slug = $1 RETURNING id', [CONFIG.tenant.slug]);
  if (result.rowCount > 0) {
    console.log(`[UNSEED] Deleted tenant ${result.rows[0].id} and all related data (CASCADE)`);
  } else {
    console.log('[UNSEED] No demo tenant found');
  }
}

// ============ CLI ============
const args = process.argv.slice(2);
if (args.includes('--clean') || args.includes('--unseed')) {
  unseed()
    .catch(e => {
      console.error('[UNSEED] Failed:', e.message);
      process.exit(1);
    })
    .finally(() => db.getPool().end());
} else if (args.includes('--verify-only')) {
  db.query(`SELECT COUNT(*) as count FROM tenants WHERE slug = $1`, [CONFIG.tenant.slug])
    .then(r => {
      if (r.rows[0].count > 0) {
        console.log('Demo tenant exists');
        process.exit(0);
      } else {
        console.log('No demo tenant found');
        process.exit(1);
      }
    })
    .catch(e => {
      console.error('Verification failed:', e.message);
      process.exit(1);
    })
    .finally(() => db.getPool().end());
} else {
  seed()
    .catch(e => {
      console.error('[SEED] Failed:', e.message);
      console.error(e.stack);
      process.exit(1);
    })
    .finally(() => db.getPool().end());
}
