/**
 * Input Sanitization Utilities for LLM Prompts
 *
 * Provides protection against common prompt injection attacks by filtering
 * or neutralizing patterns that could manipulate LLM behavior.
 */

/**
 * Sanitize text before including in LLM prompts
 * Removes or neutralizes common prompt injection patterns
 *
 * @param {string} text - Raw input text
 * @returns {string} Sanitized text safe for prompt inclusion
 */
function sanitizeForPrompt(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    // Filter instruction override attempts
    .replace(/ignore (previous|all|above|prior) instructions/gi, '[filtered]')
    .replace(/disregard (previous|all|above|prior)/gi, '[filtered]')
    // Neutralize role markers that could confuse the model
    .replace(/system\s*:/gi, 'system ')
    .replace(/assistant\s*:/gi, 'assistant ')
    // Limit excessive newlines that could be used for separation attacks
    .replace(/\n{4,}/g, '\n\n\n');
}

module.exports = { sanitizeForPrompt };
