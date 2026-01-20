const { BaseAgent } = require('./base-agent');

/**
 * Agent for detecting customer intent in conversations.
 * Extends BaseAgent to leverage common Claude interaction patterns.
 */
class IntentAgent extends BaseAgent {
  constructor() {
    super('IntentAgent');
    this.systemPrompt = `You are a customer intent detection expert. Analyze the given text and identify the customer's intent.

Return JSON:
{
  "primary_intent": "billing|support|complaint|question|feedback|general",
  "matched_topic_ids": ["topic-id-1", "topic-id-2"]
}

Guidelines:
- primary_intent: the main purpose of the customer's message
- matched_topic_ids: IDs of relevant topics (empty array if none apply)

Respond only with valid JSON.`;
  }

  /**
   * Get default intent result for error cases.
   * @returns {Object} - Default intent analysis result
   */
  getDefaultResult() {
    return {
      primary_intent: 'general',
      matched_topic_ids: []
    };
  }

  /**
   * Detect intent in the given text.
   * @param {string} text - The text to analyze
   * @param {Array<Object>} topics - Optional available topics for matching
   * @returns {Promise<Object>} - Intent detection result
   */
  async detectIntent(text, topics = []) {
    this.log('Detecting intent...');

    let prompt = this.systemPrompt;
    if (topics.length > 0) {
      const topicList = topics.map(t => `- ${t.id}: ${t.name}`).join('\n');
      prompt = prompt.replace(
        'matched_topic_ids: IDs of relevant topics',
        `matched_topic_ids: IDs from available topics:\n${topicList}`
      );
    }

    const result = await this.analyze(prompt, text, this.getDefaultResult());
    this.log('Detection complete', { primary_intent: result.primary_intent, matched_topic_ids: result.matched_topic_ids });
    return result;
  }
}

module.exports = { IntentAgent };
