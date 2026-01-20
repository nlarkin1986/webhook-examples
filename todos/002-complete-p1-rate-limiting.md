---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, performance, critical]
dependencies: []
---

# No Rate Limiting on Webhook Endpoint

## Problem Statement

The webhook endpoint has no rate limiting. Combined with missing signature verification, attackers can send unlimited requests to trigger expensive Claude API calls.

**Why it matters:**
- Cost amplification attack: Each forged webhook triggers 7-17 Claude API calls
- Queue exhaustion and denial of service
- Anthropic API quota exhaustion
- Memory exhaustion from unbounded queue growth

## Findings

**Location:**
- `/Users/natelarkin/webhook-examples/conversation-analysis/routes.js` - No rate limiting middleware
- `/Users/natelarkin/webhook-examples/conversation-analysis/index.js` - No app-level rate limiting

**Evidence from performance-oracle:**
- Each job requires 7-17 Claude API calls
- At 100 malicious requests: 700-1700 Claude API calls
- No protection against 429 cascades

**Idempotency bypass:** The 1-minute time bucket can be bypassed by waiting:
```javascript
const timeBucket = Math.floor(Date.now() / 60000);
const eventId = `${conversationId}-${req.body.type}-${timeBucket}`;
// Easy to bypass by waiting 60 seconds between requests
```

## Proposed Solutions

### Option A: Express Rate Limit Middleware (Recommended)

**Description:** Add express-rate-limit with reasonable limits per IP and globally.

**Implementation:**
```javascript
const rateLimit = require('express-rate-limit');

// Global rate limit
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute total
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});

// Per-IP rate limit
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 requests per minute per IP
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many requests from this IP' }
});

app.use('/', globalLimiter);
app.use('/', ipLimiter);
```

| Aspect | Details |
|--------|---------|
| Pros | Simple, well-tested, configurable |
| Cons | Requires new dependency |
| Effort | Small (30 minutes) |
| Risk | Low |

### Option B: Queue Size Limit

**Description:** Reject new jobs when queue exceeds threshold.

**Implementation:**
```javascript
// In routes.js
if (queueProcessor.getQueueSize() > 1000) {
  console.warn('Queue full, rejecting request');
  return res.status(503).json({ error: 'Service temporarily unavailable' });
}
```

| Aspect | Details |
|--------|---------|
| Pros | Protects against queue exhaustion |
| Cons | Doesn't prevent attack attempts, just limits damage |
| Effort | Trivial |
| Risk | Low |

### Option C: Redis-Based Rate Limiting

**Description:** Use Redis for distributed rate limiting across multiple instances.

| Aspect | Details |
|--------|---------|
| Pros | Works in multi-instance deployment |
| Cons | Requires Redis infrastructure |
| Effort | Medium |
| Risk | Medium - adds dependency |

## Recommended Action

Approved during batch triage - implement recommended option.

## Technical Details

**Affected files:**
- `conversation-analysis/index.js` - Add middleware
- `package.json` - Add express-rate-limit

**Dependencies to add:**
```json
"express-rate-limit": "^7.1.0"
```

## Acceptance Criteria

- [ ] Webhook endpoint rate limited to reasonable threshold
- [ ] Returns 429 with Retry-After header when limit exceeded
- [ ] Queue size limit prevents memory exhaustion
- [ ] Legitimate traffic not impacted (test with realistic load)
- [ ] Rate limit headers included in responses

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-20 | Created from code review | Combines with #001 for full protection |
| 2026-01-20 | Approved in triage | Status: pending → ready. Approved for implementation.
## Resources

- express-rate-limit: https://www.npmjs.com/package/express-rate-limit
- OWASP Rate Limiting: https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
