---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, code-quality, yagni]
dependencies: []
---

# Unused Fields in Agent Prompts (YAGNI)

## Problem Statement

Agent prompts request fields that aren't used downstream, adding complexity and token cost without benefit.

## Findings

**Location:**
- `conversation-analysis/agents/sentiment-agent.js`
- `conversation-analysis/agents/intent-agent.js`

**Unused fields in sentiment output:**
```javascript
// Prompt requests:
{
  "trajectory": "improving|declining|stable",
  "key_indicators": ["frustrated", "grateful", ...]
}

// But processor.js only logs full result, nothing uses these specifically
```

**Unused fields in intent output:**
```javascript
// Prompt requests:
{
  "urgency": "low|medium|high",
  "intent_confidence": <0.0 to 1.0>
}

// These are logged but not acted upon
```

## Proposed Solutions

### Option A: Remove Unused Fields (Recommended)

Simplify prompts to only request what's needed:

```javascript
// Sentiment - minimal
{
  "score": <-1.0 to 1.0>,
  "label": "positive|negative|neutral|mixed"
}

// Intent - minimal
{
  "primary_intent": "billing|support|complaint|...",
  "matched_topic_ids": ["topic-id-1", "topic-id-2"]
}
```

### Option B: Use the Fields

If these fields have value, implement:
- Urgency-based prioritization
- Trajectory-based alerting
- Confidence thresholds for topic application

| Aspect | Details |
|--------|---------|
| Effort | Small |
| Risk | Low |

## Acceptance Criteria

- [ ] Audit all requested vs. used fields
- [ ] Remove unused fields OR implement their use
- [ ] Document which fields are critical vs. optional
- [ ] Reduce token usage by simplifying prompts
