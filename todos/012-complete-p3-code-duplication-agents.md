---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, code-quality, dry]
dependencies: []
---

# Code Duplication Across Agents

## Problem Statement

The sentiment and intent agents share significant boilerplate code for Anthropic SDK setup, error handling, and response parsing. This violates DRY principles.

## Findings

**Location:**
- `conversation-analysis/agents/sentiment-agent.js`
- `conversation-analysis/agents/intent-agent.js`

**Duplicated patterns:**
```javascript
// Both files have:
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic();

// Similar try/catch with default fallback
try {
  const response = await anthropic.messages.create({...});
  // Parse JSON from response
} catch (error) {
  console.error(`[Agent] Error:`, error.message);
  return getDefaultResult();
}
```

## Proposed Solutions

### Option A: Base Agent Class (Recommended)

```javascript
// agents/base-agent.js
class BaseAgent {
  constructor(name, model = 'claude-3-haiku-20240307') {
    this.name = name;
    this.model = model;
    this.anthropic = new Anthropic();
  }

  async analyze(systemPrompt, content, defaultResult) {
    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      });
      return this.parseResponse(response);
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, ...defaultResult };
    }
  }
}
```

| Aspect | Details |
|--------|---------|
| Effort | Small |
| Risk | Low |

## Acceptance Criteria

- [ ] Common agent logic extracted to base class
- [ ] Sentiment and intent agents extend base
- [ ] Error handling consistent across agents
- [ ] No duplicated Anthropic SDK initialization
