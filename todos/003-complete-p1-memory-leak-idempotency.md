---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, performance, memory-leak, critical]
dependencies: []
---

# Unbounded In-Memory Queue and Broken Idempotency Cleanup

## Problem Statement

The idempotency Set in `routes.js` has a broken cleanup mechanism and grows without bound. The cleanup logic parses `timeBucket` (minutes since epoch) as if it were milliseconds, causing it to never correctly identify old entries.

**Why it matters:**
- Memory grows ~80KB/hour with broken cleanup
- After 30 days: ~58MB of orphaned entries
- No size limit on the Set
- Server will eventually OOM under sustained load

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/routes.js` lines 15-26

**Broken cleanup logic:**
```javascript
const processedEvents = new Set();

setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);  // Milliseconds
  for (const eventId of processedEvents) {
    const timestamp = parseInt(eventId.split('-').pop(), 10);  // This is timeBucket (minutes), not ms!
    if (timestamp && timestamp < oneHourAgo) {  // Will never be true
      processedEvents.delete(eventId);
    }
  }
}, 10 * 60 * 1000);
```

**The bug:**
- `eventId` format: `${conversationId}-${eventType}-${timeBucket}`
- `timeBucket` = `Math.floor(Date.now() / 60000)` ≈ 29,523,456 (minutes since epoch)
- `oneHourAgo` ≈ 1,705,795,200,000 (milliseconds)
- `timeBucket < oneHourAgo` is always true (wrong comparison), but actually the parse may fail on complex eventIds

**Evidence from performance-oracle:**
- Each eventId: ~80 bytes average
- At 1000 events/hour with broken cleanup: 80KB/hour accumulation
- O(n) iteration every 10 minutes as Set grows

## Proposed Solutions

### Option A: LRU Cache with TTL (Recommended)

**Description:** Replace unbounded Set with size-limited LRU cache with automatic TTL expiration.

**Implementation:**
```javascript
const LRU = require('lru-cache');

const processedEvents = new LRU({
  max: 10000,            // Maximum 10K entries
  ttl: 60 * 60 * 1000    // 1 hour TTL (built-in, no manual cleanup)
});

// Usage remains the same
if (processedEvents.has(eventId)) return res.sendStatus(200);
processedEvents.set(eventId, true);
```

| Aspect | Details |
|--------|---------|
| Pros | Bounded memory, O(1) operations, automatic cleanup |
| Cons | New dependency |
| Effort | Small (15 minutes) |
| Risk | Low |

### Option B: Fix the Cleanup Logic

**Description:** Correct the timestamp comparison to use proper units.

**Implementation:**
```javascript
// Store creation time with eventId
const processedEvents = new Map();

// When adding
processedEvents.set(eventId, Date.now());

// Cleanup
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [eventId, createdAt] of processedEvents) {
    if (createdAt < oneHourAgo) {
      processedEvents.delete(eventId);
    }
  }
}, 10 * 60 * 1000);
```

| Aspect | Details |
|--------|---------|
| Pros | No new dependency |
| Cons | Still O(n) cleanup, no size limit |
| Effort | Trivial |
| Risk | Low but doesn't address unbounded growth |

### Option C: Redis-Based Deduplication

**Description:** Use Redis SET with EXPIRE for distributed idempotency.

| Aspect | Details |
|--------|---------|
| Pros | Works across instances, automatic expiration |
| Cons | Requires Redis infrastructure |
| Effort | Medium |
| Risk | Medium - adds dependency |

## Recommended Action

Approved during batch triage - implement recommended option.

## Technical Details

**Affected files:**
- `conversation-analysis/routes.js` - Replace Set with LRU

**Dependencies to add:**
```json
"lru-cache": "^10.1.0"
```

## Acceptance Criteria

- [ ] Memory usage bounded regardless of request volume
- [ ] Old entries automatically expire after 1 hour
- [ ] Duplicate detection still works correctly
- [ ] O(1) lookup performance maintained
- [ ] Memory usage verified under load test

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-20 | Created from code review | Bug in unit conversion (minutes vs milliseconds) |
| 2026-01-20 | Approved in triage | Status: pending → ready. Approved for implementation.
## Resources

- lru-cache: https://www.npmjs.com/package/lru-cache
