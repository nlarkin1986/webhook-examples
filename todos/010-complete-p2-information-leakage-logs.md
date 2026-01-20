---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, security, logging]
dependencies: []
---

# Information Leakage in Logs

## Problem Statement

Full conversation content and API error details are logged, potentially exposing PII and internal system structure.

## Findings

**Location:**
- `conversation-analysis/processor.js` lines 101-114
- `conversation-analysis/tools/gladly-tools.js` lines 176-182

**PII in logs:**
```javascript
const logEntry = {
  conversationId,
  customerId,
  gladlyLink: `${process.env.GLADLY_HOST}/customer/${customerId}/conversation/${conversationId}`,
  results: result  // May contain full conversation content
};
console.log(JSON.stringify(logEntry, null, 2));
```

## Proposed Solutions

### Option A: PII Redaction (Recommended)

```javascript
function redactPII(obj) {
  const redacted = { ...obj };
  if (redacted.results?.sentiment?.key_indicators) {
    redacted.results.sentiment.key_indicators = '[REDACTED]';
  }
  // Redact conversation content
  return redacted;
}
```

| Aspect | Details |
|--------|---------|
| Effort | Small |
| Risk | Low |

## Acceptance Criteria

- [ ] Conversation content not logged
- [ ] Customer PII redacted from logs
- [ ] API error details sanitized
- [ ] Structured logging with log levels
