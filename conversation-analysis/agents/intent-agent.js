/**
 * Intent Classification Agent
 *
 * Classifies customer intent and matches detected topics to predefined Gladly topics.
 * Uses Claude Haiku for efficient classification.
 *
 * Output:
 * - primary_intent: main customer intent category
 * - intent_confidence: confidence in intent classification
 * - detected_topics: topics identified from conversation
 * - matched_topic_ids: IDs of predefined Gladly topics that match
 * - unmatched_topics: detected topics without a Gladly match
 * - urgency: low, medium, high
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

/**
 * Run intent classification on conversation items
 * @param {Array} conversationItems - Array of conversation message objects
 * @param {Array} availableTopics - Predefined Gladly topics from list_topics
 * @returns {Promise<object>} Intent analysis result
 */
async function runIntentAgent(conversationItems, availableTopics = []) {
  console.log(`[Intent Agent] Analyzing ${conversationItems.length} messages`);
  console.log(`[Intent Agent] ${availableTopics.length} predefined topics available`);

  // Format messages for analysis
  const formattedMessages = formatConversationForAnalysis(conversationItems);
  const formattedTopics = formatTopicsForMatching(availableTopics);

  const systemPrompt = buildSystemPrompt(formattedTopics);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Analyze the intent and topics of this customer service conversation:\n\n${formattedMessages}`
        }
      ]
    });

    // Extract JSON from response
    const textContent = response.content.find(c => c.type === 'text');
    if (textContent) {
      const result = parseJsonResponse(textContent.text);
      console.log(`[Intent Agent] Primary intent: ${result.primary_intent}`);
      console.log(`[Intent Agent] Matched ${result.matched_topic_ids?.length || 0} topics`);
      return result;
    }

    return getDefaultResult();

  } catch (error) {
    console.error(`[Intent Agent] Error:`, error.message);
    return getDefaultResult();
  }
}

/**
 * Build system prompt with available topics
 * @param {string} formattedTopics - Formatted topics list
 * @returns {string} System prompt
 */
function buildSystemPrompt(formattedTopics) {
  return `You are an intent classification specialist for customer service conversations.

Analyze the conversation and return a JSON object with:

{
  "primary_intent": "<intent category>",
  "intent_confidence": <number from 0.0 to 1.0>,
  "detected_topics": ["<topic1>", "<topic2>", ...],
  "matched_topic_ids": ["<id1>", "<id2>", ...],
  "unmatched_topics": ["<topic1>", ...],
  "urgency": "<low|medium|high>"
}

## Intent Categories
- billing: Payment, invoices, charges, refunds
- support: Technical help, troubleshooting
- complaint: Dissatisfaction, problems, issues
- question: General inquiries, information requests
- feedback: Comments, suggestions, reviews
- order: Order status, shipping, delivery
- account: Profile, settings, access issues
- returns: Returns, exchanges, refunds
- other: Doesn't fit other categories

## Available Predefined Topics
${formattedTopics || 'No predefined topics available.'}

## Matching Rules
1. Look at detected_topics and find matching predefined topics
2. Match by semantic meaning, not exact text
3. Only include IDs of topics that exist in the predefined list
4. Topics not in the predefined list go in unmatched_topics

## Urgency Guidelines
- low: General question, no time pressure
- medium: Issue affecting customer, needs attention
- high: Critical problem, very frustrated customer, potential churn

Return ONLY the JSON object, no other text.`;
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

    return `[${index + 1}] ${sender}: ${content}`;
  }).join('\n');
}

/**
 * Format topics for matching
 * @param {Array} topics - Gladly topics from list_topics
 * @returns {string} Formatted topics list
 */
function formatTopicsForMatching(topics) {
  if (!topics || topics.length === 0) {
    return '';
  }

  // Filter out disabled topics
  const activeTopics = topics.filter(t => !t.disabled);

  return activeTopics.map(topic => {
    const parent = topic.parentId
      ? topics.find(t => t.id === topic.parentId)?.name
      : null;
    const hierarchy = parent ? `${parent} > ${topic.name}` : topic.name;

    return `- ID: "${topic.id}" | Name: "${hierarchy}"`;
  }).join('\n');
}

/**
 * Extract message content from conversation item
 * @param {object} item - Conversation item
 * @returns {string} Message content
 */
function extractMessageContent(item) {
  if (!item.content) return '[No content]';

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

  return JSON.stringify(item.content).substring(0, 200);
}

/**
 * Parse JSON from LLM response
 * @param {string} text - Response text
 * @returns {object} Parsed result or default
 */
function parseJsonResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return getDefaultResult();
  } catch (error) {
    console.error(`[Intent Agent] Failed to parse JSON:`, error.message);
    return getDefaultResult();
  }
}

/**
 * Get default result for error cases
 * @returns {object} Default intent result
 */
function getDefaultResult() {
  return {
    primary_intent: 'other',
    intent_confidence: 0.5,
    detected_topics: [],
    matched_topic_ids: [],
    unmatched_topics: [],
    urgency: 'low'
  };
}

module.exports = { runIntentAgent };
