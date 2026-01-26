/**
 * Feedback Entity Extraction Service
 *
 * Extracts structured entities from conversations:
 * - Products mentioned (linked to Shopify)
 * - Issues/complaints categorized
 * - Geographic signals
 * - Topic classification (multi-label)
 * - Churn risk signals
 *
 * Security: Implements input sanitization and output schema validation
 * to prevent LLM prompt injection attacks.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const db = require('../db/connection');

const anthropic = new Anthropic();

// ============================================================================
// Output Schema Validation (Zod)
// Prevents malformed LLM responses from being accepted
// ============================================================================

const ProductMentionSchema = z.object({
  mention_text: z.string().max(500),
  product_type: z.string().max(100).optional(),
  attributes: z.array(z.string().max(50)).default([]),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  issue: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1)
});

const IssueSchema = z.object({
  category: z.enum(['product_quality', 'shipping', 'billing', 'service', 'returns', 'other']),
  subcategory: z.string().max(100).optional(),
  description: z.string().max(1000),
  severity: z.number().min(1).max(5),
  is_complaint: z.boolean(),
  is_praise: z.boolean(),
  resolution_status: z.enum(['unresolved', 'resolved', 'escalated']).optional()
});

const GeographicSignalsSchema = z.object({
  mentioned_location: z.string().max(200).optional(),
  shipping_destination: z.string().max(200).optional(),
  state_code: z.string().max(2).optional(),
  city: z.string().max(100).optional(),
  zip_prefix: z.string().max(5).optional(),
  regional_context: z.string().max(200).optional()
});

const TopicSchema = z.object({
  topic: z.string().max(100),
  subtopic: z.string().max(100).optional(),
  sentiment: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1)
});

const CustomerSignalsSchema = z.object({
  churn_risk: z.enum(['high', 'medium', 'low']).optional(),
  churn_indicators: z.array(z.string().max(200)).default([]),
  loyalty_signals: z.array(z.string().max(200)).default([])
});

const ExtractionResultSchema = z.object({
  products_mentioned: z.array(ProductMentionSchema).default([]),
  issues: z.array(IssueSchema).default([]),
  geographic_signals: GeographicSignalsSchema.optional(),
  topics: z.array(TopicSchema).default([]),
  customer_signals: CustomerSignalsSchema.optional()
});

// ============================================================================
// Input Sanitization
// Prevents prompt injection attacks via conversation content
// ============================================================================

/**
 * Sanitize conversation input to prevent prompt injection
 * @param {Array} items - Conversation items
 * @returns {Array} Sanitized items
 */
function sanitizeConversationInput(items) {
  return items.map(item => ({
    ...item,
    content: (item.content || '')
      // Zero-width space breaks code blocks
      .replace(/```/g, '\u200B`\u200B`\u200B`')
      // Remove markdown headers that could confuse the model
      .replace(/\n#{1,6}\s/g, '\n')
      // Strip HTML tags
      .replace(/<[^>]*>/g, '')
      // Limit length per message
      .slice(0, 10000)
  }));
}

// ============================================================================
// Extraction Prompt
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a customer feedback analyst. Extract structured entities from customer support conversations.

## Output Format
Return a JSON object with these fields:
{
  "products_mentioned": [
    {
      "mention_text": "the face cream",
      "product_type": "skincare",
      "attributes": ["cream", "face"],
      "sentiment": "negative",
      "issue": "skin irritation",
      "confidence": 0.92
    }
  ],
  "issues": [
    {
      "category": "product_quality|shipping|billing|service|returns|other",
      "subcategory": "skin_reaction|late_delivery|damaged|etc",
      "description": "Customer reports skin irritation after using product",
      "severity": 1-5,
      "is_complaint": true,
      "is_praise": false,
      "resolution_status": "unresolved|resolved|escalated"
    }
  ],
  "geographic_signals": {
    "mentioned_location": "Brooklyn, NY",
    "shipping_destination": "112xx area",
    "state_code": "NY",
    "city": "Brooklyn",
    "zip_prefix": "112",
    "regional_context": "urban delivery"
  },
  "topics": [
    {
      "topic": "Product Quality",
      "subtopic": "Skin Reaction",
      "sentiment": -0.8,
      "confidence": 0.95
    }
  ],
  "customer_signals": {
    "churn_risk": "high|medium|low",
    "churn_indicators": ["mentioned competitor", "requested refund"],
    "loyalty_signals": ["repeat customer", "positive history"]
  }
}

## Extraction Rules
1. Extract ALL products mentioned, even vague references
2. Categorize issues with specific subcategories
3. Note geographic signals from address or location mentions
4. Assign sentiment PER topic, not just overall
5. Flag churn risk indicators
6. Severity scale: 1=minor inconvenience, 5=critical issue
7. Be precise with confidence scores

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation.`;

// ============================================================================
// Main Extraction Functions
// ============================================================================

/**
 * Extract feedback entities from conversation items
 *
 * @param {Array} conversationItems - Array of conversation messages
 * @param {object} context - Additional context (customer profile, orders)
 * @returns {Promise<object|null>} Extracted entities or null if failed
 */
async function extractFeedbackEntities(conversationItems, context = {}) {
  // Sanitize input to prevent injection
  const sanitizedItems = sanitizeConversationInput(conversationItems);

  // Format conversation for the model
  const formattedConversation = sanitizedItems.map(item => ({
    role: item.initiator?.type === 'CUSTOMER' ? 'customer' : 'agent',
    content: item.content,
    timestamp: item.timestamp
  }));

  // Build user message with context
  const userMessage = JSON.stringify({
    conversation: formattedConversation,
    customer_context: context.customerProfile ? {
      name: context.customerProfile.name,
      email: context.customerProfile.emails?.[0]?.email,
      address: context.customerProfile.address
    } : null,
    recent_orders: context.recentOrders?.slice(0, 5)?.map(o => ({
      id: o.id,
      items: o.lineItems?.map(li => li.title)
    }))
  });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: [{
        type: 'text',
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }  // Enable prompt caching
      }],
      messages: [{
        role: 'user',
        content: userMessage
      }]
    });

    // Parse and validate response
    const responseText = response.content[0]?.text;
    if (!responseText) {
      console.warn('[FeedbackExtractor] Empty response from model');
      return null;
    }

    // Try to extract JSON from response (handle markdown code blocks)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate against schema
    const validated = ExtractionResultSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[FeedbackExtractor] Schema validation failed:', validated.error.errors);
      return null;
    }

    return validated.data;
  } catch (error) {
    console.error('[FeedbackExtractor] Extraction error:', error.message);
    return null;
  }
}

/**
 * Extract and store feedback for a conversation
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} conversationId - Gladly conversation ID
 * @param {string} customerId - Gladly customer ID
 * @param {Array} conversationItems - Conversation messages
 * @param {object} context - Additional context
 * @param {string} analysisResultId - Optional reference to analysis_results
 * @returns {Promise<object|null>} Stored feedback item or null
 */
async function extractAndStoreFeedback(tenantId, conversationId, customerId, conversationItems, context = {}, analysisResultId = null) {
  // Extract entities
  const extraction = await extractFeedbackEntities(conversationItems, context);

  if (!extraction) {
    console.log(`[FeedbackExtractor] No extraction for conversation ${conversationId}`);
    return null;
  }

  // Skip if no meaningful feedback extracted
  if (extraction.issues.length === 0 &&
      extraction.products_mentioned.length === 0 &&
      extraction.topics.length === 0) {
    console.log(`[FeedbackExtractor] No meaningful feedback in conversation ${conversationId}`);
    return null;
  }

  // Get primary issue (highest severity complaint)
  const primaryIssue = extraction.issues
    .filter(i => i.is_complaint)
    .sort((a, b) => b.severity - a.severity)[0] || extraction.issues[0];

  // Get primary product mention
  const primaryProduct = extraction.products_mentioned[0];

  // Get geographic data
  const geo = extraction.geographic_signals || {};

  // Calculate overall sentiment from topics
  const avgSentiment = extraction.topics.length > 0
    ? extraction.topics.reduce((sum, t) => sum + t.sentiment, 0) / extraction.topics.length
    : null;

  const sentimentLabel = avgSentiment !== null
    ? (avgSentiment > 0.3 ? 'positive' : avgSentiment < -0.3 ? 'negative' : 'neutral')
    : null;

  // Store feedback item
  try {
    const result = await db.queryWithTenant(tenantId, `
      INSERT INTO feedback_items (
        tenant_id, conversation_id, customer_id, analysis_result_id,
        shopify_product_id, shopify_variant_id, product_title,
        product_mention_text, product_link_confidence, product_link_method,
        issue_category, issue_subcategory, issue_description, issue_severity,
        is_complaint, is_praise, sentiment_score, sentiment_label,
        customer_state, customer_city, customer_zip_prefix, shipping_carrier,
        topics, churn_risk, churn_indicators, raw_extraction
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
      )
      ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
        analysis_result_id = EXCLUDED.analysis_result_id,
        shopify_product_id = EXCLUDED.shopify_product_id,
        product_title = EXCLUDED.product_title,
        issue_category = EXCLUDED.issue_category,
        issue_subcategory = EXCLUDED.issue_subcategory,
        issue_description = EXCLUDED.issue_description,
        issue_severity = EXCLUDED.issue_severity,
        is_complaint = EXCLUDED.is_complaint,
        is_praise = EXCLUDED.is_praise,
        sentiment_score = EXCLUDED.sentiment_score,
        sentiment_label = EXCLUDED.sentiment_label,
        topics = EXCLUDED.topics,
        churn_risk = EXCLUDED.churn_risk,
        raw_extraction = EXCLUDED.raw_extraction,
        analyzed_at = NOW()
      RETURNING *
    `, [
      tenantId,
      conversationId,
      customerId,
      analysisResultId,
      primaryProduct?.shopify_product_id || null,  // Will be filled by product linker
      primaryProduct?.shopify_variant_id || null,
      primaryProduct?.mention_text || null,
      primaryProduct?.mention_text || null,
      primaryProduct?.confidence || null,
      'unmatched',  // Will be updated by product linker
      primaryIssue?.category || null,
      primaryIssue?.subcategory || null,
      primaryIssue?.description || null,
      primaryIssue?.severity || null,
      primaryIssue?.is_complaint || false,
      extraction.issues.some(i => i.is_praise) || false,
      avgSentiment,
      sentimentLabel,
      geo.state_code || null,
      geo.city || null,
      geo.zip_prefix || null,
      null,  // shipping_carrier - to be filled from order data
      JSON.stringify(extraction.topics),
      extraction.customer_signals?.churn_risk || null,
      JSON.stringify(extraction.customer_signals?.churn_indicators || []),
      JSON.stringify(extraction)
    ]);

    console.log(`[FeedbackExtractor] Stored feedback for conversation ${conversationId}`);
    return result.rows[0];
  } catch (error) {
    console.error('[FeedbackExtractor] Storage error:', error.message);
    return null;
  }
}

/**
 * Batch extract feedback for multiple conversations
 * More efficient for processing backlogs
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Array} conversations - Array of {conversationId, customerId, items, context}
 * @returns {Promise<Array>} Array of extraction results
 */
async function batchExtractFeedback(tenantId, conversations) {
  const results = [];

  // Process in batches of 5 (balance between parallelism and rate limits)
  const batchSize = 5;
  for (let i = 0; i < conversations.length; i += batchSize) {
    const batch = conversations.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(conv =>
        extractAndStoreFeedback(
          tenantId,
          conv.conversationId,
          conv.customerId,
          conv.items,
          conv.context,
          conv.analysisResultId
        )
      )
    );

    results.push(...batchResults);

    // Rate limiting between batches
    if (i + batchSize < conversations.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

// ============================================================================
// Tiered Extraction Strategy
// Uses pattern matching first, then Haiku for simple cases, Sonnet for complex
// ============================================================================

/**
 * Assess conversation complexity for tiered extraction
 * @param {Array} items - Conversation items
 * @returns {string} 'simple' | 'moderate' | 'complex'
 */
function assessComplexity(items) {
  const totalLength = items.reduce((sum, i) => sum + (i.content?.length || 0), 0);
  const messageCount = items.length;

  if (totalLength < 500 && messageCount <= 4) return 'simple';
  if (totalLength < 2000 && messageCount <= 10) return 'moderate';
  return 'complex';
}

/**
 * Extract using tiered approach for cost optimization
 *
 * @param {Array} conversationItems - Conversation messages
 * @param {object} context - Additional context
 * @returns {Promise<object|null>} Extracted entities
 */
async function extractWithTieredApproach(conversationItems, context = {}) {
  const complexity = assessComplexity(conversationItems);
  const sanitizedItems = sanitizeConversationInput(conversationItems);

  // For simple conversations, try Haiku first
  if (complexity === 'simple') {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: JSON.stringify({ conversation: sanitizedItems })
        }]
      });

      const parsed = JSON.parse(response.content[0]?.text || '{}');
      const validated = ExtractionResultSchema.safeParse(parsed);

      if (validated.success) {
        console.log('[FeedbackExtractor] Used Haiku for simple extraction');
        return validated.data;
      }
    } catch (error) {
      console.log('[FeedbackExtractor] Haiku failed, falling back to Sonnet');
    }
  }

  // Fall back to full extraction for moderate/complex or if Haiku failed
  return extractFeedbackEntities(conversationItems, context);
}

module.exports = {
  extractFeedbackEntities,
  extractAndStoreFeedback,
  batchExtractFeedback,
  extractWithTieredApproach,
  sanitizeConversationInput,
  // Export schemas for testing
  ExtractionResultSchema
};
