/**
 * Gladly API Tools - Atomic MCP tools for the Claude Agent SDK
 *
 * Following agent-native principles:
 * - One action per tool (granularity)
 * - No bundled judgment or workflows
 * - Tools are primitives, agents compose them
 */

const { getConversation, getItems, listTopics, addTopic, updateConversation, getCustomerById } = require('../../util/api');
const { runSentimentAgent } = require('../agents/sentiment-agent');
const { runIntentAgent } = require('../agents/intent-agent');

/**
 * Topics cache with 5 minute TTL
 * Reduces redundant API calls since topics rarely change
 */
let topicsCache = { data: null, expiry: 0 };

/**
 * Get topics with caching to reduce API calls
 * @returns {Promise<Array>} List of topics
 */
async function getCachedTopics() {
  if (Date.now() < topicsCache.expiry && topicsCache.data) {
    console.log('[Topics] Using cached topics');
    return topicsCache.data;
  }

  console.log('[Topics] Fetching topics from API');
  const response = await listTopics();
  topicsCache = {
    data: response.data,
    expiry: Date.now() + 5 * 60 * 1000  // 5 min TTL
  };
  return topicsCache.data;
}

/**
 * Tool definitions following MCP schema
 * Each tool is atomic and performs a single action
 */
const toolDefinitions = [
  {
    name: 'get_conversation',
    description: 'Get a single Gladly conversation by ID. Returns conversation metadata including status, inbox, agent assignment, and timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The Gladly conversation ID'
        }
      },
      required: ['conversationId']
    }
  },
  {
    name: 'get_conversation_items',
    description: 'Get all messages/items in a Gladly conversation. Returns array of message objects with content, sender info, and timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The Gladly conversation ID'
        }
      },
      required: ['conversationId']
    }
  },
  {
    name: 'list_topics',
    description: 'List all predefined topics configured in Gladly. Returns array of topic objects with id, name, disabled status, and parentId.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'add_topic',
    description: 'Add a predefined topic to a conversation. The topicId must be an existing Gladly topic ID from list_topics.',
    input_schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The Gladly conversation ID'
        },
        topicId: {
          type: 'string',
          description: 'The predefined Gladly topic ID to add'
        }
      },
      required: ['conversationId', 'topicId']
    }
  },
  {
    name: 'remove_topic',
    description: 'Remove a topic from a conversation. Use when a topic was incorrectly applied.',
    input_schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The Gladly conversation ID'
        },
        topicId: {
          type: 'string',
          description: 'The topic ID to remove'
        }
      },
      required: ['conversationId', 'topicId']
    }
  },
  {
    name: 'get_customer',
    description: 'Get customer profile by ID. Returns customer object with name, emails, phones, and custom attributes.',
    input_schema: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'The Gladly customer ID'
        }
      },
      required: ['customerId']
    }
  },
  {
    name: 'complete_task',
    description: 'Signal that the analysis task is complete. Call this when all analysis is done and topics have been applied.',
    input_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the analysis completed successfully'
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what was done'
        },
        results: {
          type: 'object',
          description: 'Structured results object containing sentiment, intent, and topics applied'
        }
      },
      required: ['success', 'summary']
    }
  },
  {
    name: 'analyze_sentiment',
    description: 'Run sentiment analysis on conversation messages. Returns sentiment score, label, and indicators.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_content: {
          type: 'string',
          description: 'The formatted conversation messages to analyze'
        }
      },
      required: ['conversation_content']
    }
  },
  {
    name: 'analyze_intent',
    description: 'Classify customer intent and match to available topics. Returns primary intent and matched topic IDs.',
    input_schema: {
      type: 'object',
      properties: {
        conversation_content: {
          type: 'string',
          description: 'The formatted conversation messages to analyze'
        },
        available_topics: {
          type: 'array',
          description: 'List of available Gladly topics to match against'
        }
      },
      required: ['conversation_content', 'available_topics']
    }
  }
];

/**
 * Execute a tool by name with given input
 * @param {string} toolName - Name of the tool to execute
 * @param {object} input - Tool input parameters
 * @returns {Promise<object>} Tool result
 */
async function executeTool(toolName, input) {
  try {
    switch (toolName) {
      case 'get_conversation': {
        const response = await getConversation(input.conversationId);
        return {
          success: true,
          data: response.data
        };
      }

      case 'get_conversation_items': {
        const response = await getItems(input.conversationId);
        return {
          success: true,
          data: response.data
        };
      }

      case 'list_topics': {
        const data = await getCachedTopics();
        return {
          success: true,
          data: data
        };
      }

      case 'add_topic': {
        const response = await addTopic(input.conversationId, {
          topicIds: [input.topicId]
        });
        return {
          success: true,
          message: `Topic ${input.topicId} added to conversation ${input.conversationId}`
        };
      }

      case 'remove_topic': {
        // First get the current conversation to find existing topicIds
        const conversationResponse = await getConversation(input.conversationId);
        const currentTopicIds = conversationResponse.data.topicIds || [];

        // Check if the topic exists on this conversation
        if (!currentTopicIds.includes(input.topicId)) {
          return {
            success: false,
            error: `Topic ${input.topicId} is not applied to conversation ${input.conversationId}`
          };
        }

        // Filter out the topic to remove
        const updatedTopicIds = currentTopicIds.filter(id => id !== input.topicId);

        // Update the conversation with the new topicIds array
        await updateConversation(input.conversationId, {
          topicIds: updatedTopicIds
        });

        return {
          success: true,
          message: `Topic ${input.topicId} removed from conversation ${input.conversationId}`
        };
      }

      case 'get_customer': {
        const response = await getCustomerById(input.customerId);
        return {
          success: true,
          data: response.data
        };
      }

      case 'complete_task': {
        return {
          success: input.success,
          summary: input.summary,
          results: input.results || {},
          shouldContinue: false
        };
      }

      case 'analyze_sentiment': {
        // Parse conversation content if it's a JSON string of items
        let items;
        try {
          items = JSON.parse(input.conversation_content);
        } catch {
          // If not JSON, treat as pre-formatted text and pass to agent
          items = input.conversation_content;
        }
        const result = await runSentimentAgent(items);
        // Propagate the result envelope from the agent
        return result;
      }

      case 'analyze_intent': {
        // Parse conversation content if it's a JSON string of items
        let items;
        try {
          items = JSON.parse(input.conversation_content);
        } catch {
          // If not JSON, treat as pre-formatted text and pass to agent
          items = input.conversation_content;
        }
        const result = await runIntentAgent(items, input.available_topics || []);
        // Propagate the result envelope from the agent
        return result;
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Tool execution failed',
      details: error.response?.data || null
    };
  }
}

/**
 * Format tool result for Claude API response
 * @param {object} result - Raw tool result
 * @returns {string} Formatted result string
 */
function formatToolResult(result) {
  return JSON.stringify(result, null, 2);
}

module.exports = {
  toolDefinitions,
  executeTool,
  formatToolResult,
  getCachedTopics
};
