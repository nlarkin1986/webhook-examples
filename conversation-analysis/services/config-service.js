/**
 * Config Service
 *
 * Manages agent configurations for tenants, including model selection,
 * custom prompts, tool toggles, and behavior settings.
 */

const db = require('../db/connection');

// Default tool list (all tools enabled by default)
const DEFAULT_TOOLS = [
  'get_conversation',
  'get_conversation_items',
  'get_customer',
  'list_topics',
  'add_topic',
  'remove_topic',
  'analyze_sentiment',
  'analyze_intent',
  'add_note',
  'complete_task'
];

// Available models
const AVAILABLE_MODELS = {
  orchestrator: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-opus-4-20250514'],
  specialist: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514']
};

/**
 * Get agent config for a tenant
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object|null>} Config or null
 */
async function getConfig(tenantId) {
  const result = await db.query(`
    SELECT
      id,
      tenant_id,
      orchestrator_model,
      specialist_model,
      orchestrator_system_prompt,
      sentiment_system_prompt,
      intent_system_prompt,
      enabled_tools,
      auto_apply_topics,
      add_analysis_note,
      sentiment_threshold_negative,
      sentiment_threshold_positive,
      topic_mappings,
      guided_config,
      created_at,
      updated_at
    FROM agent_configs
    WHERE tenant_id = $1
  `, [tenantId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orchestratorModel: row.orchestrator_model,
    specialistModel: row.specialist_model,
    orchestratorSystemPrompt: row.orchestrator_system_prompt,
    sentimentSystemPrompt: row.sentiment_system_prompt,
    intentSystemPrompt: row.intent_system_prompt,
    enabledTools: row.enabled_tools || DEFAULT_TOOLS,
    autoApplyTopics: row.auto_apply_topics,
    addAnalysisNote: row.add_analysis_note,
    sentimentThresholdNegative: parseFloat(row.sentiment_threshold_negative),
    sentimentThresholdPositive: parseFloat(row.sentiment_threshold_positive),
    topicMappings: row.topic_mappings || {},
    guidedConfig: row.guided_config || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Update agent config for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} updates - Config updates
 * @returns {Promise<object>} Updated config
 */
async function updateConfig(tenantId, updates) {
  const fieldMap = {
    orchestratorModel: 'orchestrator_model',
    specialistModel: 'specialist_model',
    orchestratorSystemPrompt: 'orchestrator_system_prompt',
    sentimentSystemPrompt: 'sentiment_system_prompt',
    intentSystemPrompt: 'intent_system_prompt',
    enabledTools: 'enabled_tools',
    autoApplyTopics: 'auto_apply_topics',
    addAnalysisNote: 'add_analysis_note',
    sentimentThresholdNegative: 'sentiment_threshold_negative',
    sentimentThresholdPositive: 'sentiment_threshold_positive',
    topicMappings: 'topic_mappings',
    guidedConfig: 'guided_config'
  };

  const setClause = [];
  const values = [tenantId];

  for (const [jsKey, value] of Object.entries(updates)) {
    const dbKey = fieldMap[jsKey];
    if (dbKey) {
      // Validate model selections
      if (jsKey === 'orchestratorModel' && !AVAILABLE_MODELS.orchestrator.includes(value)) {
        throw new Error(`Invalid orchestrator model: ${value}`);
      }
      if (jsKey === 'specialistModel' && !AVAILABLE_MODELS.specialist.includes(value)) {
        throw new Error(`Invalid specialist model: ${value}`);
      }

      // Validate enabled tools
      if (jsKey === 'enabledTools') {
        if (!Array.isArray(value)) {
          throw new Error('enabledTools must be an array');
        }
        const invalidTools = value.filter(t => !DEFAULT_TOOLS.includes(t));
        if (invalidTools.length > 0) {
          throw new Error(`Invalid tools: ${invalidTools.join(', ')}`);
        }
      }

      // Validate thresholds
      if (jsKey === 'sentimentThresholdNegative' || jsKey === 'sentimentThresholdPositive') {
        const num = parseFloat(value);
        if (isNaN(num) || num < -1 || num > 1) {
          throw new Error(`Threshold must be between -1 and 1`);
        }
      }

      values.push(
        jsKey === 'enabledTools' || jsKey === 'topicMappings' || jsKey === 'guidedConfig'
          ? JSON.stringify(value)
          : value
      );
      setClause.push(`${dbKey} = $${values.length}`);
    }
  }

  if (setClause.length === 0) {
    throw new Error('No valid fields to update');
  }

  const result = await db.query(`
    UPDATE agent_configs
    SET ${setClause.join(', ')}
    WHERE tenant_id = $1
    RETURNING *
  `, values);

  return getConfig(tenantId);
}

/**
 * Reset config to defaults
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object>} Reset config
 */
async function resetConfig(tenantId) {
  await db.query(`
    UPDATE agent_configs
    SET
      orchestrator_model = 'claude-sonnet-4-20250514',
      specialist_model = 'claude-3-5-haiku-20241022',
      orchestrator_system_prompt = NULL,
      sentiment_system_prompt = NULL,
      intent_system_prompt = NULL,
      enabled_tools = $2::jsonb,
      auto_apply_topics = true,
      add_analysis_note = true,
      sentiment_threshold_negative = -0.3,
      sentiment_threshold_positive = 0.3,
      topic_mappings = '{}'::jsonb,
      guided_config = '{}'::jsonb
    WHERE tenant_id = $1
  `, [tenantId, JSON.stringify(DEFAULT_TOOLS)]);

  return getConfig(tenantId);
}

/**
 * Update topic mappings
 * @param {string} tenantId - Tenant UUID
 * @param {object} mappings - { intentName: topicId } mappings
 * @returns {Promise<object>} Updated config
 */
async function updateTopicMappings(tenantId, mappings) {
  return updateConfig(tenantId, { topicMappings: mappings });
}

/**
 * Toggle a specific tool
 * @param {string} tenantId - Tenant UUID
 * @param {string} toolName - Tool to toggle
 * @param {boolean} enabled - Whether to enable or disable
 * @returns {Promise<object>} Updated config
 */
async function toggleTool(tenantId, toolName, enabled) {
  if (!DEFAULT_TOOLS.includes(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const config = await getConfig(tenantId);
  const enabledTools = new Set(config.enabledTools);

  if (enabled) {
    enabledTools.add(toolName);
  } else {
    enabledTools.delete(toolName);
  }

  return updateConfig(tenantId, { enabledTools: Array.from(enabledTools) });
}

/**
 * Get available models
 * @returns {object} { orchestrator: string[], specialist: string[] }
 */
function getAvailableModels() {
  return AVAILABLE_MODELS;
}

/**
 * Get default tools list
 * @returns {string[]} List of default tool names
 */
function getDefaultTools() {
  return [...DEFAULT_TOOLS];
}

module.exports = {
  getConfig,
  updateConfig,
  resetConfig,
  updateTopicMappings,
  toggleTool,
  getAvailableModels,
  getDefaultTools
};
