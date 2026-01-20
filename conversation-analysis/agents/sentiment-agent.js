/**
 * Sentiment Analysis Agent
 *
 * Analyzes the emotional tone of customer service conversations.
 * Uses Claude Haiku for efficient classification.
 *
 * Output:
 * - score: -1.0 to 1.0 (negative to positive)
 * - label: positive, negative, neutral, mixed
 * - confidence: 0.0 to 1.0
 * - trajectory: improving, declining, stable
 * - key_indicators: array of emotional signals detected
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

const SENTIMENT_SYSTEM_PROMPT = `You are a sentiment analysis specialist for customer service conversations.

Analyze the emotional tone of the conversation and return a JSON object with:

{
  "score": <number from -1.0 to 1.0>,
  "label": "<positive|negative|neutral|mixed>",
  "confidence": <number from 0.0 to 1.0>,
  "trajectory": "<improving|declining|stable>",
  "key_indicators": ["<indicator1>", "<indicator2>", ...]
}

Guidelines:
- score: -1.0 is extremely negative, 0 is neutral, 1.0 is extremely positive
- label: overall sentiment category
- confidence: how confident you are in the assessment
- trajectory: how sentiment changed over the conversation
- key_indicators: specific phrases or signals (e.g., "frustrated", "grateful", "confused", "satisfied")

Focus on:
- Customer's emotional state (not the agent's)
- How sentiment changed from start to end
- Specific words/phrases indicating emotion
- Context clues about satisfaction level

Return ONLY the JSON object, no other text.`;

/**
 * Run sentiment analysis on conversation items
 * @param {Array} conversationItems - Array of conversation message objects
 * @returns {Promise<object>} Sentiment analysis result
 */
async function runSentimentAgent(conversationItems) {
  console.log(`[Sentiment Agent] Analyzing ${conversationItems.length} messages`);

  // Format messages for analysis
  const formattedMessages = formatConversationForAnalysis(conversationItems);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: SENTIMENT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyze the sentiment of this customer service conversation:\n\n${formattedMessages}`
        }
      ]
    });

    // Extract JSON from response
    const textContent = response.content.find(c => c.type === 'text');
    if (textContent) {
      const result = parseJsonResponse(textContent.text);
      console.log(`[Sentiment Agent] Result: ${result.label} (score: ${result.score})`);
      return result;
    }

    return getDefaultResult();

  } catch (error) {
    console.error(`[Sentiment Agent] Error:`, error.message);
    return getDefaultResult();
  }
}

/**
 * Format conversation items for analysis
 * @param {Array} items - Conversation items from Gladly
 * @returns {string} Formatted conversation text
 */
function formatConversationForAnalysis(items) {
  if (!items || items.length === 0) {
    return 'No messages in conversation.';
  }

  return items.map((item, index) => {
    const sender = item.initiator?.type === 'CUSTOMER' ? 'Customer' : 'Agent';
    const content = extractMessageContent(item);
    const timestamp = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';

    return `[${index + 1}] ${sender} (${timestamp}): ${content}`;
  }).join('\n');
}

/**
 * Extract message content from conversation item
 * @param {object} item - Conversation item
 * @returns {string} Message content
 */
function extractMessageContent(item) {
  if (!item.content) return '[No content]';

  // Handle different content types
  if (typeof item.content === 'string') {
    return item.content;
  }

  if (item.content.body) {
    return item.content.body;
  }

  if (item.content.content) {
    return item.content.content;
  }

  if (item.content.text) {
    return item.content.text;
  }

  // For complex content, try to extract text
  return JSON.stringify(item.content).substring(0, 200);
}

/**
 * Parse JSON from LLM response
 * @param {string} text - Response text
 * @returns {object} Parsed result or default
 */
function parseJsonResponse(text) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return getDefaultResult();
  } catch (error) {
    console.error(`[Sentiment Agent] Failed to parse JSON:`, error.message);
    return getDefaultResult();
  }
}

/**
 * Get default result for error cases
 * @returns {object} Default sentiment result
 */
function getDefaultResult() {
  return {
    score: 0,
    label: 'neutral',
    confidence: 0.5,
    trajectory: 'stable',
    key_indicators: []
  };
}

module.exports = { runSentimentAgent };
