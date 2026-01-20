/**
 * Webhook Routes for Conversation Analysis
 *
 * Handles Gladly webhook events:
 * - PING: Health check (required by Gladly)
 * - CONVERSATION/CREATED: Initial analysis when conversation starts
 * - CONVERSATION/CLOSED: Full analysis when conversation ends
 */

const express = require('express');
const dayjs = require('dayjs');
const { queueProcessor } = require('./processor');

// In-memory set for idempotency (prevents duplicate processing)
const processedEvents = new Set();

// Cleanup old events periodically (every 10 minutes, keep last hour)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const eventId of processedEvents) {
    const timestamp = parseInt(eventId.split('-').pop(), 10);
    if (timestamp && timestamp < oneHourAgo) {
      processedEvents.delete(eventId);
    }
  }
}, 10 * 60 * 1000);

module.exports = () => {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
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
    processedEvents.add(eventId);

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
