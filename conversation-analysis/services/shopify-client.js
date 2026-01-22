/**
 * Shopify Client Service
 *
 * Factory function that creates a Shopify GraphQL Admin API client
 * with built-in rate limiting using leaky bucket algorithm.
 */

const axios = require('axios');

// Shopify GraphQL rate limits (leaky bucket)
const SHOPIFY_BUCKET_SIZE = 1000;  // max cost points
const SHOPIFY_LEAK_RATE = 50;      // points per second

/**
 * Simple leaky bucket rate limiter for Shopify GraphQL
 */
class ShopifyRateLimiter {
  constructor() {
    this.currentBucket = SHOPIFY_BUCKET_SIZE;
    this.lastUpdate = Date.now();
  }

  /**
   * Wait if necessary to stay within rate limits
   * @param {number} cost - Estimated cost of the operation
   */
  async throttle(cost = 10) {
    // Replenish bucket based on time elapsed
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000;
    this.currentBucket = Math.min(SHOPIFY_BUCKET_SIZE, this.currentBucket + elapsed * SHOPIFY_LEAK_RATE);
    this.lastUpdate = now;

    // Wait if bucket can't afford the cost
    if (this.currentBucket < cost) {
      const waitTime = (cost - this.currentBucket) / SHOPIFY_LEAK_RATE * 1000;
      await sleep(waitTime);
      this.currentBucket = cost;
      this.lastUpdate = Date.now();
    }

    this.currentBucket -= cost;
  }
}

// Global rate limiter instances per store
const rateLimiters = new Map();

function getRateLimiter(storeUrl) {
  if (!rateLimiters.has(storeUrl)) {
    rateLimiters.set(storeUrl, new ShopifyRateLimiter());
  }
  return rateLimiters.get(storeUrl);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// GraphQL query for customer lookup by email
const CUSTOMER_BY_EMAIL_QUERY = `
  query getCustomerByEmail($email: String!) {
    customers(first: 1, query: $email) {
      edges {
        node {
          id
          email
          firstName
          lastName
          displayName
          phone
          createdAt
          updatedAt
          acceptsMarketing
          acceptsMarketingUpdatedAt
          amountSpent {
            amount
            currencyCode
          }
          numberOfOrders
          note
          tags
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet { shopMoney { amount currencyCode } }
                currentTotalPriceSet { shopMoney { amount currencyCode } }
                totalRefundedSet { shopMoney { amount currencyCode } }
                displayFinancialStatus
                displayFulfillmentStatus
                lineItems(first: 5) {
                  edges {
                    node {
                      title
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// GraphQL query for customer by Shopify ID
const CUSTOMER_BY_ID_QUERY = `
  query getCustomerById($id: ID!) {
    customer(id: $id) {
      id
      email
      firstName
      lastName
      displayName
      phone
      createdAt
      updatedAt
      acceptsMarketing
      amountSpent {
        amount
        currencyCode
      }
      numberOfOrders
      orders(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount currencyCode } }
            displayFinancialStatus
            displayFulfillmentStatus
            lineItems(first: 5) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Simple shop query for testing connection
const SHOP_QUERY = `
  query getShop {
    shop {
      name
      email
      myshopifyDomain
      plan {
        displayName
      }
    }
  }
`;

/**
 * Create a Shopify GraphQL client for a specific store
 * @param {object} credentials - Shopify credentials
 * @param {string} credentials.storeUrl - Store URL (e.g., mystore.myshopify.com)
 * @param {string} credentials.accessToken - Admin API access token
 * @returns {object} Shopify client with methods
 */
function createShopifyClient(credentials) {
  const { storeUrl, accessToken } = credentials;

  if (!storeUrl || !accessToken) {
    throw new Error('Store URL and access token are required');
  }

  const apiVersion = '2025-01';
  const endpoint = `https://${storeUrl}/admin/api/${apiVersion}/graphql.json`;

  const client = axios.create({
    baseURL: endpoint,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    }
  });

  const rateLimiter = getRateLimiter(storeUrl);

  /**
   * Execute a GraphQL query with rate limiting
   * @param {string} query - GraphQL query
   * @param {object} variables - Query variables
   * @param {number} [cost=10] - Estimated query cost
   * @returns {Promise<object>} Query result
   */
  async function graphql(query, variables = {}, cost = 10) {
    await rateLimiter.throttle(cost);

    try {
      const response = await client.post('', {
        query,
        variables
      });

      if (response.data.errors) {
        const errorMessages = response.data.errors.map(e => e.message).join(', ');
        throw new Error(`Shopify GraphQL error: ${errorMessages}`);
      }

      return response.data.data;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        if (status === 401) {
          throw new Error('Shopify authentication failed. Check your access token.');
        }
        if (status === 429) {
          // Rate limited, wait and retry once
          await sleep(2000);
          return graphql(query, variables, cost);
        }
        throw new Error(`Shopify API error (${status}): ${error.response.data?.errors?.[0]?.message || error.message}`);
      }
      throw error;
    }
  }

  return {
    /**
     * Test connection to Shopify
     * @returns {Promise<object>} Shop info
     */
    async testConnection() {
      try {
        const data = await graphql(SHOP_QUERY, {}, 2);
        return {
          success: true,
          shop: data.shop
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Get customer by email
     * @param {string} email - Customer email
     * @returns {Promise<object|null>} Customer data or null
     */
    async getCustomerByEmail(email) {
      if (!email) return null;

      const data = await graphql(CUSTOMER_BY_EMAIL_QUERY, {
        email: `email:${email}`
      }, 15);

      return data.customers?.edges?.[0]?.node || null;
    },

    /**
     * Get customer by Shopify ID
     * @param {string} id - Shopify customer ID (gid://shopify/Customer/123)
     * @returns {Promise<object|null>} Customer data or null
     */
    async getCustomerById(id) {
      if (!id) return null;

      const data = await graphql(CUSTOMER_BY_ID_QUERY, { id }, 15);
      return data.customer || null;
    },

    /**
     * Get shop info
     * @returns {Promise<object>} Shop info
     */
    async getShop() {
      const data = await graphql(SHOP_QUERY, {}, 2);
      return data.shop;
    },

    /**
     * Raw GraphQL query execution
     * @param {string} query - GraphQL query
     * @param {object} variables - Query variables
     * @returns {Promise<object>} Query result
     */
    query: graphql
  };
}

/**
 * Test Shopify connection with given credentials
 * @param {object} credentials - Shopify credentials
 * @returns {Promise<object>} { success, shop, error }
 */
async function testConnection(credentials) {
  try {
    const client = createShopifyClient(credentials);
    return await client.testConnection();
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  createShopifyClient,
  testConnection,
  ShopifyRateLimiter
};
