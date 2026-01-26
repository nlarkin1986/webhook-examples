/**
 * Claude API Rate Limiter
 *
 * Provides rate limiting for Claude API calls using Bottleneck.
 * Configured to prevent hitting Anthropic rate limits under load.
 *
 * Configuration:
 * - 50 requests per minute (reservoir)
 * - Maximum 5 concurrent requests
 *
 * Usage:
 *   const { rateLimitedClaudeCall } = require('./utils/claude-limiter');
 *   const response = await rateLimitedClaudeCall(anthropic, { model: '...', ... });
 */

const Bottleneck = require('bottleneck');

// Create a shared rate limiter for all Claude API calls
const claudeLimiter = new Bottleneck({
  // Token bucket: 50 requests per minute
  reservoir: 50,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000, // 1 minute

  // Concurrency limit
  maxConcurrent: 5
});

// Log rate limiter events for debugging
claudeLimiter.on('error', (error) => {
  console.error('[Claude Limiter] Error:', error.message);
});

claudeLimiter.on('failed', (error, jobInfo) => {
  console.warn(`[Claude Limiter] Job failed (attempt ${jobInfo.retryCount}):`, error.message);
  // Retry on rate limit errors (429)
  if (error.status === 429 && jobInfo.retryCount < 3) {
    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, jobInfo.retryCount) * 1000;
    console.log(`[Claude Limiter] Retrying in ${delay}ms...`);
    return delay;
  }
});

claudeLimiter.on('retry', (error, jobInfo) => {
  console.log(`[Claude Limiter] Retrying job (attempt ${jobInfo.retryCount + 1})`);
});

/**
 * Execute a rate-limited Claude API call
 * @param {object} anthropic - Anthropic client instance
 * @param {object} params - Parameters for anthropic.messages.create()
 * @returns {Promise<object>} Claude API response
 */
async function rateLimitedClaudeCall(anthropic, params) {
  return claudeLimiter.schedule(() => anthropic.messages.create(params));
}

module.exports = { claudeLimiter, rateLimitedClaudeCall };
