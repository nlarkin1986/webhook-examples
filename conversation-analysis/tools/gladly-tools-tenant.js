/**
 * Tenant-Aware Gladly API Tools
 *
 * MCP tools for the Claude Agent SDK that use tenant-specific Gladly clients.
 * Each tool executor receives the tenant's Gladly client instead of using env vars.
 *
 * Following agent-native principles:
 * - One action per tool (granularity)
 * - No bundled judgment or workflows
 * - Tools are primitives, agents compose them
 */

const { runSentimentAgent } = require('../agents/sentiment-agent');
const { runIntentAgent } = require('../agents/intent-agent');
const { customer360ToolDefinitions, createCustomer360ToolExecutor } = require('./customer-360-tools');

/**
 * Topics cache with 5 minute TTL per tenant
 * Key: tenantId, Value: { data, expiry }
 */
const topicsCacheByTenant = new Map();

/**
 * Get topics with caching for a specific tenant
 * @param {object} gladlyClient - Tenant's Gladly API client
 * @param {string} tenantId - Tenant ID for cache key
 * @returns {Promise<Array>} List of topics
 */
async function getCachedTopics(gladlyClient, tenantId) {
  const cached = topicsCacheByTenant.get(tenantId);

  if (cached && Date.now() < cached.expiry && cached.data) {
    console.log(`[Topics] Using cached topics for tenant ${tenantId}`);
    return cached.data;
  }

  console.log(`[Topics] Fetching topics from API for tenant ${tenantId}`);
  const response = await gladlyClient.listTopics();

  topicsCacheByTenant.set(tenantId, {
    data: response.data,
    expiry: Date.now() + 5 * 60 * 1000  // 5 min TTL
  });

  return response.data;
}

/**
 * Clear topics cache for a tenant (e.g., after config change)
 * @param {string} tenantId - Tenant ID
 */
function clearTopicsCache(tenantId) {
  topicsCacheByTenant.delete(tenantId);
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
  },
  {
    name: 'add_note',
    description: 'Add a note to the conversation with the analysis summary. Use this after analysis is complete to document the results.',
    input_schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The Gladly conversation ID'
        },
        body: {
          type: 'string',
          description: 'The note content (plain text or markdown)'
        }
      },
      required: ['conversationId', 'body']
    }
  }
];

/**
 * Get all tool definitions (base + Customer 360)
 * @returns {Array} All tool definitions
 */
function getAllToolDefinitions() {
  return [...toolDefinitions, ...customer360ToolDefinitions];
}

/**
 * Get filtered tool definitions based on tenant config
 * @param {object} config - Tenant agent config
 * @returns {Array} Filtered tool definitions
 */
function getEnabledToolDefinitions(config) {
  const allTools = getAllToolDefinitions();
  const enabledTools = config?.enabledTools || allTools.map(t => t.name);
  return allTools.filter(tool => enabledTools.includes(tool.name));
}

/**
 * Create a tool executor bound to a specific tenant context
 * @param {object} tenantContext - Tenant context from middleware
 * @param {object} tenantContext.gladlyClient - Gladly API client
 * @param {string} tenantContext.id - Tenant ID
 * @param {object} tenantContext.config - Agent config
 * @returns {Function} Tool executor function
 */
function createToolExecutor(tenantContext) {
  const { gladlyClient, id: tenantId, config } = tenantContext;

  // Create Customer 360 tool executor with tenant context
  const executeCustomer360Tool = createCustomer360ToolExecutor(tenantId, { gladlyClient });

  // Get Customer 360 tool names for routing
  const customer360ToolNames = customer360ToolDefinitions.map(t => t.name);

  /**
   * Execute a tool by name with given input
   * @param {string} toolName - Name of the tool to execute
   * @param {object} input - Tool input parameters
   * @returns {Promise<object>} Tool result
   */
  return async function executeTool(toolName, input) {
    // Check if tool is enabled
    const allTools = getAllToolDefinitions();
    const enabledTools = config?.enabledTools || allTools.map(t => t.name);
    if (!enabledTools.includes(toolName)) {
      return {
        success: false,
        error: `Tool '${toolName}' is not enabled for this tenant`
      };
    }

    // Route Customer 360 tools to their executor
    if (customer360ToolNames.includes(toolName)) {
      return executeCustomer360Tool(toolName, input);
    }

    try {
      switch (toolName) {
        case 'get_conversation': {
          const response = await gladlyClient.getConversation(input.conversationId);
          return {
            success: true,
            data: response.data
          };
        }

        case 'get_conversation_items': {
          const response = await gladlyClient.getConversationItems(input.conversationId);
          return {
            success: true,
            data: response.data
          };
        }

        case 'list_topics': {
          const data = await getCachedTopics(gladlyClient, tenantId);
          return {
            success: true,
            data: data
          };
        }

        case 'add_topic': {
          await gladlyClient.addTopicToConversation(input.conversationId, {
            topicIds: [input.topicId]
          });
          return {
            success: true,
            message: `Topic ${input.topicId} added to conversation ${input.conversationId}`
          };
        }

        case 'remove_topic': {
          const conversationResponse = await gladlyClient.getConversation(input.conversationId);
          const currentTopicIds = conversationResponse.data.topicIds || [];

          if (!currentTopicIds.includes(input.topicId)) {
            return {
              success: false,
              error: `Topic ${input.topicId} is not applied to conversation ${input.conversationId}`
            };
          }

          const updatedTopicIds = currentTopicIds.filter(id => id !== input.topicId);
          await gladlyClient.updateConversation(input.conversationId, {
            topicIds: updatedTopicIds
          });

          return {
            success: true,
            message: `Topic ${input.topicId} removed from conversation ${input.conversationId}`
          };
        }

        case 'get_customer': {
          const response = await gladlyClient.getCustomerById(input.customerId);
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
          let items;
          try {
            items = JSON.parse(input.conversation_content);
          } catch {
            items = input.conversation_content;
          }
          // TODO: Pass tenant config for custom sentiment prompt
          const result = await runSentimentAgent(items, config?.sentimentSystemPrompt);
          return result;
        }

        case 'analyze_intent': {
          let items;
          try {
            items = JSON.parse(input.conversation_content);
          } catch {
            items = input.conversation_content;
          }
          // TODO: Pass tenant config for custom intent prompt
          const result = await runIntentAgent(items, input.available_topics || [], config?.intentSystemPrompt);
          return result;
        }

        case 'add_note': {
          if (config?.addAnalysisNote === false) {
            return {
              success: true,
              message: 'Note skipped (disabled in tenant config)'
            };
          }

          const payload = {
            conversationId: input.conversationId,
            content: {
              type: 'NOTE',
              body: input.body
            }
          };
          await gladlyClient.createItem(payload);
          return {
            success: true,
            message: `Note added to conversation ${input.conversationId}`
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
  };
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
  getAllToolDefinitions,
  getEnabledToolDefinitions,
  createToolExecutor,
  formatToolResult,
  getCachedTopics,
  clearTopicsCache
};
