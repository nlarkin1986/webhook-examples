/**
 * Webhook Routes for Conversation Analysis
 *
 * Handles Gladly webhook events:
 * - PING: Health check (required by Gladly)
 * - CONVERSATION/CREATED: Initial analysis when conversation starts
 * - CONVERSATION/CLOSED: Full analysis when conversation ends
 */

const crypto = require('crypto');
const express = require('express');
const { LRUCache } = require('lru-cache');
const { queueProcessor } = require('./processor');

/**
 * Format timestamp for logging in YYYY-MM-DD HH:mm:ss format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Middleware to verify Gladly webhook signatures
 * Uses HMAC-SHA256 with timestamp validation to prevent replay attacks
 */
function verifyWebhookSignature(req, res, next) {
  // Allow PING requests through without signature verification
  // (required by Gladly for initial webhook endpoint validation)
  if (req.body && req.body.type === 'PING') {
    return next();
  }

  const signature = req.headers['x-gladly-signature'];
  const timestamp = req.headers['x-gladly-timestamp'];
  const secret = process.env.GLADLY_WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) {
    console.log(`[${formatTimestamp()}] Webhook signature verification failed: missing signature, timestamp, or secret`);
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Prevent replay attacks (5 minute window)
  const now = Math.floor(Date.now() / 1000);
  const requestTimestamp = parseInt(timestamp, 10);
  if (Math.abs(now - requestTimestamp) > 300) {
    console.log(`[${formatTimestamp()}] Webhook signature verification failed: request too old`);
    return res.status(401).json({ error: 'Request too old' });
  }

  // Compute expected signature
  const payload = `${timestamp}.${JSON.stringify(req.body)}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    console.log(`[${formatTimestamp()}] Webhook signature verification failed: invalid signature`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

// LRU cache for idempotency (prevents duplicate processing)
// Bounded to 10K entries with 1 hour TTL - handles cleanup automatically
const processedEvents = new LRUCache({
  max: 10000,
  ttl: 60 * 60 * 1000  // 1 hour
});

module.exports = () => {
  const router = express.Router();

  router.post('/', verifyWebhookSignature, async (req, res) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] Got POST from Gladly: ${req.body.type}`);

    // Handle PING (required by Gladly to validate webhook endpoint)
    if (req.body.type === 'PING') {
      console.log(`[${timestamp}] Got PING event - sending 200 OK`);
      return res.sendStatus(200);
    }

    // Only process conversation events we care about
    const validTypes = ['CONVERSATION/CREATED', 'CONVERSATION/CLOSED'];
    if (!validTypes.includes(req.body.type)) {
      console.log(`[${timestamp}] Ignoring event type: ${req.body.type}`);
      return res.sendStatus(200);
    }

    // Extract IDs from webhook payload
    const conversationId = req.body.content?.conversationId;
    const customerId = req.body.content?.customerId;

    if (!conversationId) {
      console.log(`[${timestamp}] Missing conversationId in webhook payload`);
      return res.sendStatus(200);
    }

    // Create idempotency key (conversationId + event type + timestamp bucket)
    // Using 1-minute buckets to allow re-processing after some time
    const timeBucket = Math.floor(Date.now() / 60000);
    const eventId = `${conversationId}-${req.body.type}-${timeBucket}`;

    // Check for duplicate
    if (processedEvents.has(eventId)) {
      console.log(`[${timestamp}] Duplicate event detected, skipping: ${eventId}`);
      return res.sendStatus(200);
    }

    // Mark as processed
    processedEvents.set(eventId, true);

    // Check queue size limit to prevent memory exhaustion
    const currentQueueSize = queueProcessor.getQueueSize();
    if (currentQueueSize > 1000) {
      console.warn(`[${timestamp}] Queue full (${currentQueueSize} jobs), rejecting request`);
      processedEvents.delete(eventId); // Allow retry when queue clears
      return res.status(503).json({ error: 'Service temporarily unavailable' });
    }

    // Return 200 immediately (async processing)
    res.sendStatus(200);
    console.log(`[${timestamp}] Queuing analysis for conversation ${conversationId}`);

    // Queue for background processing
    try {
      queueProcessor.add({
        eventId,
        eventType: req.body.type,
        conversationId,
        customerId,
        receivedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[${timestamp}] Error queuing job:`, error);
      // Don't fail - we already sent 200
    }
  });

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queueSize: queueProcessor.getQueueSize()
    });
  });

  return router;
};
