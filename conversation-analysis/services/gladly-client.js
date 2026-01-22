/**
 * Per-Tenant Gladly API Client
 *
 * Creates Gladly API clients configured with tenant-specific credentials.
 * Replaces the global env-based client with tenant isolation.
 */

const axios = require('axios');

/**
 * Create a Gladly API client for a specific tenant
 * @param {object} credentials - Tenant credentials
 * @param {string} credentials.gladlyHost - Gladly host (e.g., company.gladly.com)
 * @param {string} credentials.gladlyUsername - API user email
 * @param {string} credentials.gladlyApiToken - Decrypted API token
 * @returns {object} Gladly client with API methods
 */
function createGladlyClient(credentials) {
  const { gladlyHost, gladlyUsername, gladlyApiToken } = credentials;

  // Generate Basic Auth header
  const authToken = Buffer.from(`${gladlyUsername}:${gladlyApiToken}`).toString('base64');

  // Base axios instance for this tenant
  const client = axios.create({
    baseURL: `https://${gladlyHost}`,
    timeout: 300 * 1000,  // 5 minute timeout
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Basic ${authToken}`
    }
  });

  // Request/response logging
  client.interceptors.request.use((config) => {
    console.log(`[GladlyClient] ${config.method.toUpperCase()} ${config.url}`);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      console.error(`[GladlyClient] Error: ${error.response?.status} - ${error.message}`);
      throw error;
    }
  );

  return {
    // Expose the host for reference
    host: gladlyHost,

    // Raw request method for custom calls
    request: async (method, path, body) => {
      const config = { method, url: path };
      if (body && method !== 'GET') {
        config.data = body;
      }
      return client(config);
    },

    // === Customer APIs ===

    getCustomerById: (id) => client.get(`/api/v1/customer-profiles/${id}`),

    updateCustomer: (customerObject) =>
      client.patch(`/api/v1/customer-profiles/${customerObject.id}`, customerObject),

    // === Conversation APIs ===

    getConversation: (id) => client.get(`/api/v1/conversations/${id}`),

    getConversationItems: (id) => client.get(`/api/v1/conversations/${id}/items`),

    updateConversation: (id, payload) =>
      client.patch(`/api/v1/conversations/${id}`, payload),

    addTopicToConversation: (id, payload) =>
      client.post(`/api/v1/conversations/${id}/topics`, payload),

    // === Conversation Items ===

    getConversationItem: (id) => client.get(`/api/v1/conversation-items/${id}`),

    createItem: (payload) => client.post(`/api/v1/conversation-items`, payload),

    replyToMessage: (id, payload) =>
      client.post(`/api/v1/conversation-items/${id}/reply`, payload),

    // === Organization APIs ===

    listTopics: () => client.get(`/api/v1/topics`),

    createTopic: (payload) => client.post(`/api/v1/topics`, payload),

    listInboxes: () => client.get(`/api/v1/inboxes`),

    listAgents: () => client.get(`/api/v1/agents`),

    getOrganization: () => client.get(`/api/v1/organization`),

    // === Task APIs ===

    createTask: (taskObject) => client.post(`/api/v1/tasks`, taskObject),

    // === Message Automation APIs ===

    handoffToAgent: (sessionId, payload) =>
      client.post(`/api/v1/message-automation/sessions/${sessionId}/handoff`, payload),

    getAutomationSessionMessages: (sessionId) =>
      client.get(`/api/v1/message-automation/sessions/${sessionId}/messages`),

    sendOutboundAutomationMessage: (sessionId, payload) =>
      client.post(`/api/v1/message-automation/sessions/${sessionId}/messages`, payload)
  };
}

/**
 * Test Gladly connection with given credentials
 * @param {object} credentials - Credentials to test
 * @returns {Promise<object>} { success, organization, error }
 */
async function testConnection(credentials) {
  try {
    const client = createGladlyClient(credentials);
    const response = await client.getOrganization();

    return {
      success: true,
      organization: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

module.exports = {
  createGladlyClient,
  testConnection
};
