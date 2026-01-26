/**
 * Conversation Analysis Webhook Server
 *
 * Listens for Gladly webhook events (CONVERSATION/CREATED and CONVERSATION/CLOSED)
 * and triggers AI-powered analysis using Claude agents.
 */

// Load environment variables
require('dotenv').config();

// Required libraries
const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');

const app = express();

// Rate limiting middleware

// Global rate limit: 100 requests per minute total
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false   // Disable X-RateLimit-* headers
});

// Per-IP rate limit: 20 requests per minute per IP
const ipLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many requests from this IP' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiters to webhook endpoint
app.use('/', globalLimiter);
app.use('/', ipLimiter);

// Body parsing middleware
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: () => true }));

// Routes
const analysisRoutes = require('./routes');
app.use('/', analysisRoutes());

// Start server
const port = process.env.ANALYSIS_PORT || 8001;
app.listen(port, () => {
  console.log(`Conversation Analysis server listening on port ${port}`);
  console.log(`Webhook endpoint: POST http://localhost:${port}/`);
});
