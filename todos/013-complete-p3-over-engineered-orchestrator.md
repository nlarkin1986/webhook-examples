---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, code-quality, simplicity]
dependencies: []
---

# Over-Engineered Orchestrator Loop

## Problem Statement

The orchestrator uses a full agentic loop with tool calls for a fixed workflow. Since the analysis steps are always the same (fetch → sentiment → intent → apply topics), this adds complexity without flexibility benefits.

## Findings

**Location:** `conversation-analysis/agents/orchestrator.js`

**Current approach:**
```javascript
// Agentic loop with max iterations
while (continueLoop && iterations < 25) {
  const response = await anthropic.messages.create({...});
  // Process tool calls...
  iterations++;
}
```

**Actual workflow is fixed:**
1. Get conversation
2. Get items
3. Run sentiment analysis
4. Run intent analysis
5. Apply topics
6. Complete

## Proposed Solutions

### Option A: Direct Function Calls (Recommended)

```javascript
async function analyze(conversationId, customerId) {
  // Fixed workflow, no agentic loop needed
  const [conversation, items, customer, topics] = await Promise.all([
    getConversation(conversationId),
    getItems(conversationId),
    getCustomerById(customerId),
    listTopics()
  ]);

  const content = formatConversation(items);

  const [sentiment, intent] = await Promise.all([
    sentimentAgent.analyze(content),
    intentAgent.analyze(content, topics)
  ]);

  for (const topicId of intent.matched_topic_ids) {
    await addTopic(conversationId, topicId);
  }

  return { sentiment, intent };
}
```

### Option B: Keep Agentic Loop for Flexibility

Keep current design if we anticipate:
- Dynamic analysis steps based on content
- Self-correcting behavior (retry on poor results)
- Future agent-driven decision making

| Aspect | Details |
|--------|---------|
| Effort | Medium |
| Risk | Low |

## Acceptance Criteria

- [ ] Evaluate if agentic loop provides value for fixed workflow
- [ ] If simplified: reduce to direct function calls
- [ ] If kept: document why flexibility is needed
- [ ] Parallel data fetching regardless of approach
