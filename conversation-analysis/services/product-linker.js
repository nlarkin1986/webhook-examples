/**
 * Product Linker Service
 *
 * Three-layer detection pipeline to link product mentions to Shopify catalog:
 * 1. Pattern Matching - SKU codes, product IDs (fast, high precision)
 * 2. Order Context - Match against customer's recent orders
 * 3. Fuzzy Catalog Matching - Levenshtein distance + attribute matching
 *
 * Updates feedback_items with linked Shopify product IDs.
 */

const db = require('../db/connection');

// ============================================================================
// Product Catalog Cache
// Caches Shopify products per tenant to reduce API calls
// ============================================================================

class ProductCatalogCache {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Get cached catalog or fetch from database/API
   * @param {string} tenantId - Tenant UUID
   * @param {Function} fetchFn - Function to fetch products if not cached
   * @returns {Promise<Array>} Product catalog
   */
  async get(tenantId, fetchFn) {
    const cached = this.cache.get(tenantId);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.products;
    }

    const products = await fetchFn();
    this.cache.set(tenantId, {
      products,
      timestamp: Date.now()
    });

    return products;
  }

  /**
   * Invalidate cache for a tenant
   * @param {string} tenantId - Tenant UUID
   */
  invalidate(tenantId) {
    this.cache.delete(tenantId);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }
}

const catalogCache = new ProductCatalogCache();

// ============================================================================
// Pattern Matching (Layer 1)
// Fast, high-precision matching using SKU patterns
// ============================================================================

/**
 * SKU patterns for different formats
 */
const SKU_PATTERNS = [
  /\b([A-Z]{2,4}-\d{4,6})\b/i,        // ABC-12345
  /\bSKU[:\s]?([A-Z0-9]{5,10})\b/i,   // SKU: ABC123
  /\b#(\d{5,8})\b/,                    // #12345678
  /\border[:\s]?#?(\d{6,10})\b/i,     // order #123456
  /\bproduct[:\s]?#?([A-Z0-9]{5,12})\b/i, // product #ABC123
  /\bitem[:\s]?#?([A-Z0-9]{5,12})\b/i     // item ABC123
];

/**
 * Extract SKUs/IDs from text using pattern matching
 * @param {string} text - Text to search
 * @returns {Array} Array of {match_type, matched_value, confidence}
 */
function extractPatternMatches(text) {
  if (!text) return [];

  const matches = [];

  for (const pattern of SKU_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push({
        match_type: 'sku',
        matched_value: match[1],
        confidence: 0.98
      });
    }
  }

  return matches;
}

/**
 * Try to match mention text to a product via SKU pattern
 * @param {string} mentionText - Product mention text
 * @param {Array} catalog - Product catalog
 * @returns {object|null} Match result or null
 */
function matchByPattern(mentionText, catalog) {
  const patternMatches = extractPatternMatches(mentionText);

  if (patternMatches.length === 0) return null;

  for (const pm of patternMatches) {
    // Search catalog for matching SKU
    const product = catalog.find(p =>
      p.sku?.toLowerCase() === pm.matched_value.toLowerCase() ||
      p.variants?.some(v => v.sku?.toLowerCase() === pm.matched_value.toLowerCase())
    );

    if (product) {
      const matchedVariant = product.variants?.find(v =>
        v.sku?.toLowerCase() === pm.matched_value.toLowerCase()
      );

      return {
        linked: true,
        shopify_product_id: product.id,
        shopify_variant_id: matchedVariant?.id || null,
        product_title: product.title,
        method: 'pattern',
        confidence: pm.confidence,
        reasoning: `Matched SKU pattern: ${pm.matched_value}`
      };
    }
  }

  return null;
}

// ============================================================================
// Order Context Matching (Layer 2)
// Match against customer's recent orders
// ============================================================================

/**
 * Match mention against customer's recent orders
 * @param {object} mention - Product mention {mention_text, attributes, product_type}
 * @param {Array} orders - Customer's recent orders
 * @returns {object|null} Match result or null
 */
function matchFromOrders(mention, orders) {
  if (!orders || orders.length === 0) return null;

  const mentionLower = (mention.mention_text || '').toLowerCase();
  const attributes = mention.attributes || [];

  let bestMatch = null;
  let bestScore = 0;

  for (const order of orders) {
    for (const item of order.lineItems || []) {
      const titleLower = (item.title || '').toLowerCase();

      // Title word overlap
      const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2);
      const mentionWords = mentionLower.split(/\s+/).filter(w => w.length > 2);
      const wordOverlap = titleWords.filter(w => mentionWords.includes(w)).length;

      // Attribute overlap
      const attrOverlap = attributes.filter(attr =>
        titleLower.includes(attr.toLowerCase())
      ).length;

      // Calculate score
      const wordScore = wordOverlap * 0.2;
      const attrScore = attrOverlap * 0.3;
      const recencyBonus = 0.1; // Orders are recent, so slight bonus

      const totalScore = wordScore + attrScore + recencyBonus;

      if (totalScore > bestScore && totalScore > 0.4) {
        bestScore = totalScore;
        bestMatch = {
          linked: true,
          shopify_product_id: item.product?.id || item.productId,
          shopify_variant_id: item.variant?.id || item.variantId,
          product_title: item.title,
          method: 'order_context',
          confidence: Math.min(totalScore, 0.95),
          reasoning: `Matched via order history: "${item.title}" (score: ${totalScore.toFixed(2)})`
        };
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// Fuzzy Catalog Matching (Layer 3)
// Levenshtein distance + attribute + product type matching
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshtein(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate string similarity (0-1) using Levenshtein distance
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score 0-1
 */
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - (distance / maxLen);
}

/**
 * Fuzzy match mention against product catalog
 * @param {object} mention - Product mention {mention_text, attributes, product_type}
 * @param {Array} catalog - Product catalog
 * @returns {object|null} Match result or null
 */
function fuzzyMatchCatalog(mention, catalog) {
  if (!catalog || catalog.length === 0) return null;

  const searchText = (mention.mention_text || '').toLowerCase();
  const attributes = mention.attributes || [];
  const productType = mention.product_type || '';

  let bestMatch = null;
  let bestScore = 0;

  for (const product of catalog) {
    const titleLower = (product.title || '').toLowerCase();

    // 1. String similarity (Levenshtein)
    const similarity = stringSimilarity(searchText, titleLower);

    // 2. Attribute matching
    let attrScore = 0;
    for (const attr of attributes) {
      if (titleLower.includes(attr.toLowerCase())) {
        attrScore += 0.15;
      }
      // Also check product tags
      if (product.tags?.some(t => t.toLowerCase().includes(attr.toLowerCase()))) {
        attrScore += 0.1;
      }
    }

    // 3. Product type matching
    let typeScore = 0;
    if (productType && product.productType) {
      if (product.productType.toLowerCase().includes(productType.toLowerCase())) {
        typeScore = 0.25;
      }
    }

    // 4. Word overlap bonus
    const searchWords = searchText.split(/\s+/).filter(w => w.length > 2);
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2);
    const wordOverlap = searchWords.filter(w =>
      titleWords.some(tw => tw.includes(w) || w.includes(tw))
    ).length;
    const wordScore = wordOverlap * 0.1;

    // Calculate total score
    const totalScore = (similarity * 0.4) + attrScore + typeScore + wordScore;

    if (totalScore > bestScore && totalScore > 0.45) {
      bestScore = totalScore;
      bestMatch = {
        linked: true,
        shopify_product_id: product.id,
        product_title: product.title,
        product_type: product.productType,
        method: 'fuzzy_catalog',
        confidence: Math.min(totalScore, 0.9),
        reasoning: `Fuzzy match: "${product.title}" (score: ${totalScore.toFixed(2)})`
      };
    }
  }

  return bestMatch;
}

// ============================================================================
// Main Linking Functions
// ============================================================================

/**
 * Link product mentions using the three-layer pipeline
 *
 * @param {Array} mentions - Product mentions from extraction
 * @param {Array} catalog - Product catalog
 * @param {Array} customerOrders - Customer's recent orders (optional)
 * @returns {Array} Mentions with linking information added
 */
function linkProductMentions(mentions, catalog, customerOrders = []) {
  const linked = [];

  for (const mention of mentions) {
    // Layer 1: Pattern matching (SKU codes)
    let match = matchByPattern(mention.mention_text, catalog);

    if (!match) {
      // Layer 2: Order context
      match = matchFromOrders(mention, customerOrders);
    }

    if (!match) {
      // Layer 3: Fuzzy catalog matching
      match = fuzzyMatchCatalog(mention, catalog);
    }

    if (match) {
      linked.push({ ...mention, ...match });
    } else {
      // No match found
      linked.push({
        ...mention,
        linked: false,
        method: 'unmatched',
        confidence: 0,
        reasoning: 'No matching product found in catalog'
      });
    }
  }

  return linked;
}

/**
 * Link and update feedback items in database
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} feedbackId - Feedback item UUID
 * @param {Array} catalog - Product catalog
 * @param {Array} customerOrders - Customer's recent orders
 * @returns {Promise<object|null>} Updated feedback item
 */
async function linkAndUpdateFeedback(tenantId, feedbackId, catalog, customerOrders = []) {
  // Get the feedback item
  const result = await db.queryWithTenant(tenantId, `
    SELECT * FROM feedback_items WHERE id = $1
  `, [feedbackId]);

  const feedback = result.rows[0];
  if (!feedback) return null;

  // Skip if already linked
  if (feedback.product_link_method !== 'unmatched' && feedback.shopify_product_id) {
    return feedback;
  }

  // Parse raw extraction to get product mentions
  const rawExtraction = feedback.raw_extraction || {};
  const mentions = rawExtraction.products_mentioned || [];

  if (mentions.length === 0) {
    return feedback;
  }

  // Link mentions
  const linkedMentions = linkProductMentions(mentions, catalog, customerOrders);

  // Get best linked product (highest confidence)
  const bestLink = linkedMentions
    .filter(m => m.linked)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (!bestLink) {
    return feedback;
  }

  // Update feedback item
  const updateResult = await db.queryWithTenant(tenantId, `
    UPDATE feedback_items
    SET
      shopify_product_id = $1,
      shopify_variant_id = $2,
      product_title = $3,
      product_link_confidence = $4,
      product_link_method = $5
    WHERE id = $6
    RETURNING *
  `, [
    bestLink.shopify_product_id,
    bestLink.shopify_variant_id || null,
    bestLink.product_title,
    bestLink.confidence,
    bestLink.method,
    feedbackId
  ]);

  console.log(`[ProductLinker] Linked feedback ${feedbackId} to product ${bestLink.product_title} (${bestLink.method})`);
  return updateResult.rows[0];
}

/**
 * Batch link feedback items for a tenant
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Array} catalog - Product catalog
 * @param {Function} getCustomerOrders - Function to fetch customer orders
 * @param {number} limit - Maximum items to process
 * @returns {Promise<object>} {processed, linked, failed}
 */
async function batchLinkFeedback(tenantId, catalog, getCustomerOrders = null, limit = 100) {
  // Get unlinked feedback items
  const result = await db.queryWithTenant(tenantId, `
    SELECT id, customer_id FROM feedback_items
    WHERE product_link_method = 'unmatched'
      AND raw_extraction->'products_mentioned' IS NOT NULL
      AND jsonb_array_length(raw_extraction->'products_mentioned') > 0
    ORDER BY analyzed_at DESC
    LIMIT $1
  `, [limit]);

  const stats = { processed: 0, linked: 0, failed: 0 };

  for (const row of result.rows) {
    try {
      // Get customer orders if function provided
      let orders = [];
      if (getCustomerOrders && row.customer_id) {
        orders = await getCustomerOrders(row.customer_id);
      }

      const updated = await linkAndUpdateFeedback(tenantId, row.id, catalog, orders);

      stats.processed++;
      if (updated?.shopify_product_id) {
        stats.linked++;
      }
    } catch (error) {
      console.error(`[ProductLinker] Error linking ${row.id}:`, error.message);
      stats.failed++;
    }
  }

  return stats;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Core functions
  linkProductMentions,
  linkAndUpdateFeedback,
  batchLinkFeedback,

  // Layer functions (for testing)
  extractPatternMatches,
  matchByPattern,
  matchFromOrders,
  fuzzyMatchCatalog,

  // Utilities
  stringSimilarity,
  levenshtein,

  // Cache
  catalogCache
};
