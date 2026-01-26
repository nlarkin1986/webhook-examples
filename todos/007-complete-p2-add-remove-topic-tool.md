---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, architecture, agent-native]
dependencies: []
---

# Missing remove_topic Tool

## Problem Statement

The agent can add topics but cannot remove them. If a topic is incorrectly applied, there's no way to undo it via tools. This violates the agent-native parity principle.

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/tools/gladly-tools.js`

**Current capability:**
- `add_topic` - YES
- `remove_topic` - MISSING

**Agent-native parity requires:** Any action a user can do in the UI, the agent should be able to do.

## Proposed Solutions

### Option A: Add remove_topic Tool (Recommended)

```javascript
{
  name: 'remove_topic',
  description: 'Remove a topic from a conversation',
  input_schema: {
    type: 'object',
    properties: {
      conversationId: { type: 'string' },
      topicId: { type: 'string' }
    },
    required: ['conversationId', 'topicId']
  }
}
```

**Note:** Check if Gladly API supports topic removal. May need `updateConversation` with modified topicIds array.

| Aspect | Details |
|--------|---------|
| Effort | Small |
| Risk | Low |

## Acceptance Criteria

- [ ] Agent can remove incorrectly applied topics
- [ ] Tool integrated into orchestrator prompt
- [ ] Error handling for non-existent topics
