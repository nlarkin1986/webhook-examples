---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, performance, api]
dependencies: []
---

# No Claude API Rate Limiting

## Problem Statement

All Claude API calls fire without rate limiting or queuing. Under load, this can exhaust Anthropic rate limits causing 429 errors and cascading failures.

## Findings

**Location:**
- `conversation-analysis/agents/orchestrator.js`
- `conversation-analysis/agents/sentiment-agent.js`
- `conversation-analysis/agents/intent-agent.js`

**API calls per job:**
- Orchestrator: 5-15 Claude Sonnet calls
- Specialists: 2 Claude Haiku calls
- **Total: 7-17 API calls per conversation**

**At 100 conversations/hour:** 700-1700 Claude API calls

## Proposed Solutions

### Option A: Token Bucket Rate Limiter (Recommended)

```javascript
const Bottleneck = require('bottleneck');

const claudeLimiter = new Bottleneck({
  reservoir: 50,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 5
});

// Wrap all Claude calls
const response = await claudeLimiter.schedule(() =>
  anthropic.messages.create({...})
);
```

| Aspect | Details |
|--------|---------|
| Effort | Medium |
| Risk | Low |

## Acceptance Criteria

- [ ] Claude API calls rate limited
- [ ] 429 errors handled gracefully
- [ ] Rate limit configurable via env var
- [ ] Metrics on API call rate available
