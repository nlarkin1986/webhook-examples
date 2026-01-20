---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, security, critical]
dependencies: []
---

# Missing Webhook Signature Verification

## Problem Statement

The webhook endpoint in `conversation-analysis/routes.js` accepts ANY POST request without verifying it originated from Gladly. There is no signature verification, HMAC validation, or source IP validation.

**Why it matters:** Anyone on the internet can send forged webhook requests to trigger expensive AI processing, potentially causing:
- Cost amplification attacks (unlimited Claude API calls)
- Denial of service via queue flooding
- Information disclosure if attackers can inject malicious conversation IDs

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/routes.js` lines 31-46

**Current vulnerable code:**
```javascript
router.post('/', async (req, res) => {
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
  console.log(`[${timestamp}] Got POST from Gladly: ${req.body.type}`);

  // Handle PING (required by Gladly to validate webhook endpoint)
  if (req.body.type === 'PING') {
    return res.sendStatus(200);
  }
  // No signature verification - accepts any request
```

**Evidence:** Security-sentinel agent identified this as CVSS 9.1 (CRITICAL)

## Proposed Solutions

### Option A: HMAC Signature Verification (Recommended)

**Description:** Implement HMAC-SHA256 signature verification using a shared secret configured in Gladly webhook settings.

**Implementation:**
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-gladly-signature'];
  const timestamp = req.headers['x-gladly-timestamp'];
  const secret = process.env.GLADLY_WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Prevent replay attacks (5 minute window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    return res.status(401).json({ error: 'Request too old' });
  }

  const payload = `${timestamp}.${JSON.stringify(req.body)}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

// Apply middleware
router.post('/', verifyWebhookSignature, async (req, res) => { ... });
```

| Aspect | Details |
|--------|---------|
| Pros | Industry standard, prevents forged requests, includes replay protection |
| Cons | Requires Gladly webhook secret configuration |
| Effort | Small (1-2 hours) |
| Risk | Low - standard security pattern |

### Option B: IP Allowlisting

**Description:** Only accept requests from known Gladly IP ranges.

| Aspect | Details |
|--------|---------|
| Pros | Simple to implement |
| Cons | Gladly IPs may change, doesn't prevent compromised Gladly accounts |
| Effort | Small |
| Risk | Medium - IP ranges need maintenance |

### Option C: API Key Header

**Description:** Require a custom API key header that matches configured secret.

| Aspect | Details |
|--------|---------|
| Pros | Very simple |
| Cons | No replay protection, weaker than HMAC |
| Effort | Trivial |
| Risk | Medium - less secure than Option A |

## Recommended Action

Implement Option A (HMAC Signature Verification) - industry standard, includes replay protection.

## Technical Details

**Affected files:**
- `conversation-analysis/routes.js` - Add middleware
- `.env-sample` - Add `GLADLY_WEBHOOK_SECRET`
- `package.json` - No changes (crypto is built-in)

**Environment variables to add:**
```bash
GLADLY_WEBHOOK_SECRET=your-webhook-secret-here
```

## Acceptance Criteria

- [ ] Webhook endpoint rejects requests without valid signature
- [ ] Replay attacks prevented (timestamp validation)
- [ ] Timing-safe comparison used (prevent timing attacks)
- [ ] PING requests still work for Gladly webhook validation
- [ ] Secret stored in environment variable, not code
- [ ] 401 response for invalid signatures (not 500)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-20 | Created from code review | security-sentinel identified as CVSS 9.1 |
| 2026-01-20 | Approved in triage | Status: pending → ready. Critical security fix approved.

## Resources

- PR: feature/conversation-analysis branch
- Gladly webhook docs: https://developer.gladly.com/webhooks
- OWASP Webhook Security: https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html
