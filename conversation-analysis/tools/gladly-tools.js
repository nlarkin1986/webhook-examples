/**
 * Gladly API Tools - Atomic MCP tools for the Claude Agent SDK
 *
 * Following agent-native principles:
 * - One action per tool (granularity)
 * - No bundled judgment or workflows
 * - Tools are primitives, agents compose them
 */

const { getConversation, getItems, listTopics, addTopic, getCustomerById } = require('../../util/api');

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
        const response = await listTopics();
        return {
          success: true,
          data: response.data
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
  formatToolResult
};
