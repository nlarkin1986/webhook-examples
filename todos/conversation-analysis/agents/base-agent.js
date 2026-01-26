const Anthropic = require('@anthropic-ai/sdk');

/**
 * Base agent class providing common functionality for all Claude-powered agents.
 * Handles Anthropic SDK setup, error handling, and response parsing.
 */
class BaseAgent {
  constructor(name, model = 'claude-3-haiku-20240307') {
    this.name = name;
    this.model = model;
    this.anthropic = new Anthropic();
  }

  /**
   * Call Claude with a system prompt and user content.
   * @param {string} systemPrompt - The system instructions for Claude
   * @param {string} userContent - The user message content to analyze
   * @param {number} maxTokens - Maximum tokens for the response
   * @returns {Promise<Object>} - The raw API response
   */
  async callClaude(systemPrompt, userContent, maxTokens = 1024) {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    });
    return response;
  }

  /**
   * Parse JSON from Claude's response text.
   * @param {Object} response - The API response object
   * @returns {Object} - Parsed JSON object
   * @throws {Error} - If no valid JSON found in response
   */
  parseJsonResponse(response) {
    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Analyze content with error handling and default fallback.
   * @param {string} systemPrompt - The system instructions for Claude
   * @param {string} content - The content to analyze
   * @param {Object} defaultResult - Default result to return on error
   * @returns {Promise<Object>} - Analysis result or default on error
   */
  async analyze(systemPrompt, content, defaultResult) {
    try {
      const response = await this.callClaude(systemPrompt, content);
      return this.parseJsonResponse(response);
    } catch (error) {
      this.logError('Analysis failed', error);
      return { success: false, ...defaultResult };
    }
  }

  /**
   * Log a message with the agent name prefix.
   * @param {string} message - The message to log
   * @param {*} data - Optional data to include
   */
  log(message, data = null) {
    const prefix = `[${this.name}]`;
    if (data) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Log an error with the agent name prefix.
   * @param {string} message - The error message
   * @param {Error} error - The error object
   */
  logError(message, error) {
    console.error(`[${this.name}] ${message}:`, error.message);
  }
}

module.exports = { BaseAgent };
