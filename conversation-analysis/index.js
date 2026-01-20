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

const app = express();

// Middleware
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
