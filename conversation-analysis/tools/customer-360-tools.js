/**
 * Customer 360 Tools - Atomic MCP tools for Customer Intelligence
 *
 * Following agent-native principles:
 * - One action per tool (granularity)
 * - No bundled judgment or workflows
 * - Tools are primitives, agents compose them
 *
 * These tools extend the orchestrator to support Customer 360 features:
 * - Shopify data fetching
 * - Customer profile enrichment
 * - Tier assignment
 */

const customer360Service = require('../services/customer-360-service');
const { createShopifyClient } = require('../services/shopify-client');
const shopifyCredentialService = require('../services/shopify-credential-service');
const { calculateCustomerMetrics, assignCustomerTier, formatRecentOrders } = require('../services/metrics-calculator');

/**
 * Tool definitions following MCP schema
 * Each tool is atomic and performs a single action
 */
const customer360ToolDefinitions = [
  {
    name: 'get_shopify_customer',
    description: 'Fetch customer order history and financial metrics from Shopify by email. Returns LTV, AOV, order count, and recent orders.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address to look up in Shopify'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_customer_360',
    description: 'Get complete 360-degree customer view combining Gladly profile with Shopify metrics. Includes tier, LTV, sentiment, and conversation count.',
    input_schema: {
      type: 'object',
      properties: {
        gladly_customer_id: {
          type: 'string',
          description: 'Gladly customer ID'
        }
      },
      required: ['gladly_customer_id']
    }
  },
  {
    name: 'update_customer_360',
    description: 'Update the customer 360 record with new data. Use after fetching Shopify metrics or completing analysis.',
    input_schema: {
      type: 'object',
      properties: {
        gladly_customer_id: {
          type: 'string',
          description: 'Gladly customer ID'
        },
        shopify_data: {
          type: 'object',
          description: 'Shopify customer data and metrics'
        },
        gladly_profile: {
          type: 'object',
          description: 'Gladly customer profile data'
        }
      },
      required: ['gladly_customer_id']
    }
  },
  {
    name: 'list_customers',
    description: 'List customer 360 profiles with optional filtering by tier, search, and sorting.',
    input_schema: {
      type: 'object',
      properties: {
        tier: {
          type: 'string',
          enum: ['top', 'vip', 'standard', 'new', 'at_risk'],
          description: 'Filter by customer tier'
        },
        search: {
          type: 'string',
          description: 'Search by name or email'
        },
        sortBy: {
          type: 'string',
          enum: ['ltv', 'gross_revenue', 'total_orders', 'avg_sentiment_score', 'last_transaction_at'],
          description: 'Sort field (default: ltv)'
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)'
        }
      },
      required: []
    }
  },
  {
    name: 'get_customer_events',
    description: 'Get activity stream of events for a customer including orders, conversations, and analysis results.',
    input_schema: {
      type: 'object',
      properties: {
        customer_360_id: {
          type: 'string',
          description: 'Customer 360 record UUID'
        },
        event_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by event types: order, refund, analysis'
        },
        limit: {
          type: 'number',
          description: 'Max events to return (default: 20)'
        }
      },
      required: ['customer_360_id']
    }
  },
  {
    name: 'sync_shopify_customer',
    description: 'Trigger on-demand Shopify data sync for a specific customer. Use to refresh stale data.',
    input_schema: {
      type: 'object',
      properties: {
        customer_360_id: {
          type: 'string',
          description: 'Customer 360 record UUID'
        },
        force: {
          type: 'boolean',
          description: 'Force sync even if recently synced (default: false)'
        }
      },
      required: ['customer_360_id']
    }
  }
];

/**
 * Create a tool executor with tenant context
 * @param {string} tenantId - Tenant UUID
 * @param {object} clients - { gladlyClient, shopifyClient } - Optional pre-configured clients
 * @returns {Function} Tool executor function
 */
function createCustomer360ToolExecutor(tenantId, clients = {}) {
  // Lazily create Shopify client when needed
  let shopifyClient = clients.shopifyClient;

  async function getShopifyClient() {
    if (shopifyClient) return shopifyClient;

    const credentials = await shopifyCredentialService.getCredentials(tenantId);
    if (!credentials) {
      throw new Error('Shopify credentials not configured for this tenant');
    }

    shopifyClient = createShopifyClient(credentials);
    return shopifyClient;
  }

  /**
   * Execute a Customer 360 tool
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   * @returns {Promise<object>} Tool result
   */
  return async function executeCustomer360Tool(toolName, input) {
    try {
      switch (toolName) {
        case 'get_shopify_customer': {
          const client = await getShopifyClient();
          const shopifyCustomer = await client.getCustomerByEmail(input.email);

          if (!shopifyCustomer) {
            return {
              success: true,
              data: {
                customer_found: false,
                message: 'No Shopify customer found for this email'
              }
            };
          }

          const metrics = calculateCustomerMetrics(shopifyCustomer);
          const recentOrders = formatRecentOrders(shopifyCustomer, 5);

          return {
            success: true,
            data: {
              customer_found: true,
              shopify_id: shopifyCustomer.id,
              email: shopifyCustomer.email,
              name: shopifyCustomer.displayName || `${shopifyCustomer.firstName || ''} ${shopifyCustomer.lastName || ''}`.trim(),
              accepts_marketing: shopifyCustomer.acceptsMarketing,
              metrics,
              recent_orders: recentOrders
            }
          };
        }

        case 'get_customer_360': {
          const customer = await customer360Service.getCustomer360ByGladlyId(tenantId, input.gladly_customer_id);

          if (!customer) {
            return {
              success: true,
              data: null,
              message: 'Customer 360 record not found'
            };
          }

          return {
            success: true,
            data: {
              id: customer.id,
              gladly_customer_id: customer.gladly_customer_id,
              shopify_customer_id: customer.shopify_customer_id,
              display_name: customer.display_name,
              email: customer.email,
              phone: customer.phone,
              photo_url: customer.photo_url,
              tier: customer.tier,
              tier_reason: customer.tier_reason,
              gross_revenue: customer.gross_revenue,
              net_revenue: customer.net_revenue,
              ltv: customer.ltv,
              aov: customer.aov,
              currency: customer.currency,
              total_orders: customer.total_orders,
              total_returns: customer.total_returns,
              last_transaction_at: customer.last_transaction_at,
              total_conversations: customer.total_conversations,
              avg_sentiment_score: customer.avg_sentiment_score,
              latest_sentiment_label: customer.latest_sentiment_label,
              shopify_synced_at: customer.shopify_synced_at,
              gladly_synced_at: customer.gladly_synced_at
            }
          };
        }

        case 'update_customer_360': {
          // Find or create customer record
          let customer = await customer360Service.getCustomer360ByGladlyId(tenantId, input.gladly_customer_id);

          if (!customer && input.gladly_profile) {
            customer = await customer360Service.findOrCreateCustomer360(
              tenantId,
              input.gladly_customer_id,
              input.gladly_profile
            );
          }

          if (!customer) {
            return {
              success: false,
              error: 'Could not find or create customer 360 record'
            };
          }

          // Update with Shopify data if provided
          if (input.shopify_data) {
            const { shopify_customer, metrics } = input.shopify_data;
            if (shopify_customer && metrics) {
              await customer360Service.updateShopifyMetrics(
                tenantId,
                customer.id,
                shopify_customer,
                metrics
              );
            }
          }

          // Update analysis aggregates
          await customer360Service.updateAnalysisAggregates(tenantId, customer.id);

          // Re-calculate tier
          const updatedCustomer = await customer360Service.getCustomer360ById(tenantId, customer.id);
          const thresholds = await customer360Service.getTierThresholds(tenantId);
          const { tier, reason } = assignCustomerTier({
            totalOrders: updatedCustomer.total_orders,
            ltv: parseFloat(updatedCustomer.ltv) || 0,
            avgSentiment: updatedCustomer.avg_sentiment_score
          }, thresholds);

          await customer360Service.updateCustomerTier(tenantId, customer.id, tier, reason);

          return {
            success: true,
            message: 'Customer 360 record updated',
            customer_id: customer.id,
            tier,
            tier_reason: reason
          };
        }

        case 'list_customers': {
          const result = await customer360Service.listCustomers(tenantId, {
            tier: input.tier,
            search: input.search,
            sortBy: input.sortBy || 'ltv',
            pageSize: input.limit || 20
          });

          return {
            success: true,
            data: result.data.map(c => ({
              id: c.id,
              display_name: c.display_name,
              email: c.email,
              tier: c.tier,
              ltv: c.ltv,
              total_orders: c.total_orders,
              avg_sentiment_score: c.avg_sentiment_score
            })),
            total: result.total
          };
        }

        case 'get_customer_events': {
          let client = null;
          try {
            client = await getShopifyClient();
          } catch {
            // Shopify not configured, will skip order events
          }

          const events = await customer360Service.getCustomerEvents(
            tenantId,
            input.customer_360_id,
            { shopifyClient: client, gladlyClient: clients.gladlyClient },
            {
              limit: input.limit || 20,
              eventTypes: input.event_types
            }
          );

          return {
            success: true,
            data: events
          };
        }

        case 'sync_shopify_customer': {
          const client = await getShopifyClient();

          const customer = await customer360Service.getCustomer360ById(tenantId, input.customer_360_id);
          if (!customer) {
            return {
              success: false,
              error: 'Customer 360 record not found'
            };
          }

          if (!customer.email) {
            return {
              success: false,
              error: 'Customer has no email address for Shopify lookup'
            };
          }

          // Check if force or data is stale
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          if (!input.force && customer.shopify_synced_at && new Date(customer.shopify_synced_at) > oneHourAgo) {
            return {
              success: true,
              message: 'Data is fresh, no sync needed',
              last_synced: customer.shopify_synced_at
            };
          }

          // Fetch from Shopify
          const shopifyCustomer = await client.getCustomerByEmail(customer.email);

          if (!shopifyCustomer) {
            return {
              success: true,
              message: 'No Shopify customer found for this email',
              synced: false
            };
          }

          const metrics = calculateCustomerMetrics(shopifyCustomer);
          await customer360Service.updateShopifyMetrics(tenantId, customer.id, shopifyCustomer, metrics);

          // Re-calculate tier
          const thresholds = await customer360Service.getTierThresholds(tenantId);
          const { tier, reason } = assignCustomerTier({
            totalOrders: metrics.orderCount,
            ltv: metrics.ltv,
            avgSentiment: customer.avg_sentiment_score
          }, thresholds);

          await customer360Service.updateCustomerTier(tenantId, customer.id, tier, reason);

          return {
            success: true,
            message: 'Shopify data synced successfully',
            synced: true,
            metrics,
            tier,
            tier_reason: reason
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
  customer360ToolDefinitions,
  createCustomer360ToolExecutor,
  formatToolResult
};
