---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, architecture, agent-native]
dependencies: []
---

# Specialist Agents Not Exposed as Tools

## Problem Statement

The orchestrator has hardcoded logic that decides when to run sentiment and intent agents. This violates the agent-native composability principle - a prompt change cannot alter this behavior.

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/agents/orchestrator.js` lines 154-194

**Hardcoded dispatch:**
```javascript
if (itemsToolUse && !messages.some(m => m._hasAgentResults)) {
  const [sentimentResult, intentResult] = await Promise.all([
    runSentimentAgent(itemsData.data),
    runIntentAgent(itemsData.data, ...)
  ]);
}
```

**Impact:** Cannot add new analysis types without code changes.

## Proposed Solutions

### Option A: Expose as Tools (Recommended)

Add `analyze_sentiment` and `analyze_intent` to tool definitions.

```javascript
{
  name: 'analyze_sentiment',
  description: 'Run sentiment analysis on conversation messages',
  input_schema: {
    properties: {
      conversation_items: { type: 'array' }
    }
  }
}
```

| Aspect | Details |
|--------|---------|
| Pros | True composability, new agents via prompt only |
| Cons | More orchestrator iterations |
| Effort | Medium |
| Risk | Low |

## Acceptance Criteria

- [ ] Sentiment analysis available as tool
- [ ] Intent analysis available as tool
- [ ] Orchestrator decides when to call via prompt
- [ ] New analysis types addable without code changes
