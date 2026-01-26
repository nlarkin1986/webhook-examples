/**
 * Config Controller
 *
 * Handles agent configuration management.
 */

const configService = require('../../services/config-service');
const { sanitizeInput, validateGuidedConfig } = require('../../services/prompt-compiler');
const { logAudit } = require('../../middleware/auth');

/**
 * GET /api/admin/config
 * Get agent configuration
 */
async function getConfig(req, res) {
  try {
    const config = await configService.getConfig(req.user.tenantId);

    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    res.json(config);
  } catch (error) {
    console.error('[Config] Get config error:', error.message);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
}

/**
 * PATCH /api/admin/config
 * Update agent configuration
 */
async function updateConfig(req, res) {
  const updates = req.body;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  try {
    const config = await configService.updateConfig(req.user.tenantId, updates);

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'config_updated',
      resourceType: 'config',
      resourceId: config.id,
      details: { fields: Object.keys(updates) },
      ipAddress: req.ip
    });

    res.json(config);
  } catch (error) {
    console.error('[Config] Update config error:', error.message);

    if (error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to update configuration' });
  }
}

/**
 * POST /api/admin/config/reset
 * Reset configuration to defaults
 */
async function resetConfig(req, res) {
  try {
    const config = await configService.resetConfig(req.user.tenantId);

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'config_reset',
      resourceType: 'config',
      resourceId: config.id,
      ipAddress: req.ip
    });

    res.json({
      message: 'Configuration reset to defaults',
      config
    });
  } catch (error) {
    console.error('[Config] Reset config error:', error.message);
    res.status(500).json({ error: 'Failed to reset configuration' });
  }
}

/**
 * GET /api/admin/config/models
 * Get available models
 */
async function getModels(req, res) {
  const models = configService.getAvailableModels();
  res.json(models);
}

/**
 * GET /api/admin/config/tools
 * Get available tools
 */
async function getTools(req, res) {
  const tools = configService.getDefaultTools();

  // Include descriptions for UI
  const toolsWithDescriptions = tools.map(name => ({
    name,
    description: getToolDescription(name)
  }));

  res.json({ tools: toolsWithDescriptions });
}

/**
 * PATCH /api/admin/config/topic-mappings
 * Update topic mappings
 */
async function updateTopicMappings(req, res) {
  const { mappings } = req.body;

  if (!mappings || typeof mappings !== 'object') {
    return res.status(400).json({ error: 'mappings object is required' });
  }

  try {
    const config = await configService.updateTopicMappings(req.user.tenantId, mappings);

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'topic_mappings_updated',
      resourceType: 'config',
      resourceId: config.id,
      details: { mappingCount: Object.keys(mappings).length },
      ipAddress: req.ip
    });

    res.json({ message: 'Topic mappings updated', topicMappings: config.topicMappings });
  } catch (error) {
    console.error('[Config] Update topic mappings error:', error.message);
    res.status(500).json({ error: 'Failed to update topic mappings' });
  }
}

/**
 * Get tool description for UI
 */
function getToolDescription(toolName) {
  const descriptions = {
    get_conversation: 'Fetch conversation metadata from Gladly',
    get_conversation_items: 'Fetch all messages in a conversation',
    get_customer: 'Fetch customer profile information',
    list_topics: 'List available Gladly topics',
    add_topic: 'Add a topic to a conversation',
    remove_topic: 'Remove a topic from a conversation',
    analyze_sentiment: 'Run AI sentiment analysis on messages',
    analyze_intent: 'Classify customer intent and match topics',
    add_note: 'Add analysis summary note to conversation',
    complete_task: 'Signal analysis completion'
  };

  return descriptions[toolName] || 'No description available';
}

/**
 * POST /api/admin/config/guided
 * Save guided prompt builder configuration
 */
async function saveGuidedConfig(req, res) {
  const { guidedConfig } = req.body;

  if (!guidedConfig || typeof guidedConfig !== 'object') {
    return res.status(400).json({ error: 'guidedConfig object is required' });
  }

  // Validate using prompt-compiler validation
  const validation = validateGuidedConfig(guidedConfig);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Sanitize brand name to prevent prompt injection
  const sanitizedConfig = {
    ...guidedConfig,
    brand: guidedConfig.brand ? {
      ...guidedConfig.brand,
      name: guidedConfig.brand.name ? sanitizeInput(guidedConfig.brand.name) : ''
    } : { name: '', tone: 'friendly' }
  };

  try {
    const config = await configService.updateConfig(req.user.tenantId, {
      guidedConfig: sanitizedConfig
    });

    // Log audit event
    await logAudit({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'guided_config_saved',
      resourceType: 'config',
      resourceId: config.id,
      details: {
        brandName: sanitizedConfig.brand?.name,
        tone: sanitizedConfig.brand?.tone,
        scenarios: Object.keys(sanitizedConfig.scenarios || {}).filter(
          k => sanitizedConfig.scenarios[k]?.enabled
        )
      },
      ipAddress: req.ip
    });

    res.json({
      message: 'Guided configuration saved',
      guidedConfig: config.guidedConfig
    });
  } catch (error) {
    console.error('[Config] Save guided config error:', error.message);
    res.status(500).json({ error: 'Failed to save guided configuration' });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  resetConfig,
  getModels,
  getTools,
  updateTopicMappings,
  saveGuidedConfig
};
