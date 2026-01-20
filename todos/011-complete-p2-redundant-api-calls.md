---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, performance, optimization]
dependencies: []
---

# Redundant Gladly API Calls

## Problem Statement

The orchestrator makes sequential tool calls when parallel would work, and `list_topics` is called for every conversation despite topics rarely changing.

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/agents/orchestrator.js`

**Inefficiencies:**
1. Sequential tool calls through agentic loop (2-3 extra Claude iterations)
2. `list_topics` called per conversation (should be cached)
3. `add_topic` called N times for N topics (API supports batch)

## Proposed Solutions

### Option A: Pre-fetch and Cache (Recommended)

```javascript
let topicsCache = { data: null, expiry: 0 };

async function getCachedTopics() {
  if (Date.now() < topicsCache.expiry) {
    return topicsCache.data;
  }
  const response = await listTopics();
  topicsCache = {
    data: response.data,
    expiry: Date.now() + 5 * 60 * 1000  // 5 min TTL
  };
  return topicsCache.data;
}

// Pre-fetch all data in parallel
const [conversation, items, customer, topics] = await Promise.all([
  getConversation(conversationId),
  getItems(conversationId),
  getCustomerById(customerId),
  getCachedTopics()
]);
```

| Aspect | Details |
|--------|---------|
| Effort | Medium |
| Risk | Low |

## Acceptance Criteria

- [ ] Topics cached with 5 minute TTL
- [ ] Data fetched in parallel before orchestration
- [ ] Batch topic application uses single API call
- [ ] ~50% reduction in Gladly API calls
