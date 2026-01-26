const { BaseAgent } = require('./base-agent');

/**
 * Agent for analyzing sentiment in customer conversations.
 * Extends BaseAgent to leverage common Claude interaction patterns.
 */
class SentimentAgent extends BaseAgent {
  constructor() {
    super('SentimentAgent');
    this.systemPrompt = `You are a sentiment analysis expert. Analyze the sentiment of the given text.

Return JSON:
{
  "score": <-1.0 to 1.0>,
  "label": "positive|negative|neutral|mixed"
}

Guidelines:
- score: -1.0 is most negative, 0 is neutral, 1.0 is most positive
- label: categorize the overall sentiment

Respond only with valid JSON.`;
  }

  /**
   * Get default sentiment result for error cases.
   * @returns {Object} - Default sentiment analysis result
   */
  getDefaultResult() {
    return {
      score: 0,
      label: 'neutral'
    };
  }

  /**
   * Analyze sentiment of the given text.
   * @param {string} text - The text to analyze
   * @returns {Promise<Object>} - Sentiment analysis result
   */
  async analyzeSentiment(text) {
    this.log('Analyzing sentiment...');
    const result = await this.analyze(this.systemPrompt, text, this.getDefaultResult());
    this.log('Analysis complete', { score: result.score, label: result.label });
    return result;
  }
}

module.exports = { SentimentAgent };
