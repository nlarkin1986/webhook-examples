/**
 * Prompt Compiler Service
 *
 * Compiles structured guided_config into actual prompts for the AI agents.
 * This service transforms user-friendly configuration into the raw prompts
 * used by the orchestrator, sentiment, and intent agents.
 */

const DANGEROUS_PATTERNS = [
  /ignore previous instructions/i,
  /disregard all prior/i,
  /system:/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /forget everything/i,
  /new instructions:/i,
];

const TONE_DESCRIPTIONS = {
  professional: 'Maintain a professional, authoritative tone. Use formal language and industry-standard terminology.',
  friendly: 'Be warm, approachable, and conversational. Use positive language and show genuine care.',
  casual: 'Use a relaxed, informal style. Feel free to use contractions and everyday language.',
  empathetic: 'Lead with understanding and validation. Acknowledge feelings before problem-solving.',
  efficient: 'Be direct and solution-focused. Minimize small talk while remaining polite.',
};

const SCENARIO_PROMPTS = {
  order_tracking: {
    name: 'Order Tracking',
    intent_category: 'order',
    default_guidance: 'Help customers locate and understand their order status. Provide tracking links when available.',
  },
  returns: {
    name: 'Returns & Exchanges',
    intent_category: 'returns',
    default_guidance: 'Guide customers through the return process. Clarify policy, timeframes, and refund methods.',
  },
  product_questions: {
    name: 'Product Questions',
    intent_category: 'question',
    default_guidance: 'Answer product inquiries with accurate specifications, recommendations, and comparisons.',
  },
  complaints: {
    name: 'Complaints',
    intent_category: 'complaint',
    default_guidance: 'Acknowledge concerns, apologize sincerely, and work toward resolution.',
  },
};

/**
 * Sanitizes user input to prevent prompt injection attacks
 * @param {string} input - User-provided text
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized input
 * @throws {Error} If dangerous patterns are detected
 */
function sanitizeInput(input, maxLength = 100) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const sanitized = input.trim().slice(0, maxLength);

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      throw new Error('Invalid characters detected in input');
    }
  }

  return sanitized;
}

/**
 * Compiles the orchestrator prompt from guided configuration
 * @param {Object} guidedConfig - The structured configuration object
 * @returns {string} The compiled orchestrator prompt
 */
function compileOrchestratorPrompt(guidedConfig) {
  if (!guidedConfig || Object.keys(guidedConfig).length === 0) {
    return null; // Return null to use defaults
  }

  const { brand, scenarios } = guidedConfig;

  if (!brand || !brand.name) {
    return null;
  }

  const sanitizedBrandName = sanitizeInput(brand.name, 100);
  const tone = brand.tone || 'friendly';

  const parts = [
    `You are an AI customer service assistant for ${sanitizedBrandName}, a retail company.`,
    '',
    '## Communication Style',
    TONE_DESCRIPTIONS[tone] || TONE_DESCRIPTIONS.friendly,
    '',
    '## Industry Context',
    'Focus on product availability, pricing, promotions, and in-store/online shopping experience.',
    '',
    '## Scenario Handling',
  ];

  // Add enabled scenarios
  if (scenarios) {
    for (const [key, config] of Object.entries(scenarios)) {
      if (config && config.enabled !== false) {
        const scenario = SCENARIO_PROMPTS[key];
        if (scenario) {
          parts.push(`\n### ${scenario.name}`);
          parts.push(scenario.default_guidance);
        }
      }
    }
  } else {
    // Default: all scenarios enabled
    for (const [key, scenario] of Object.entries(SCENARIO_PROMPTS)) {
      parts.push(`\n### ${scenario.name}`);
      parts.push(scenario.default_guidance);
    }
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * Generates a preview of the compiled prompt for the UI
 * @param {Object} guidedConfig - The structured configuration object
 * @returns {string} Preview text of the compiled prompt
 */
function compilePromptPreview(guidedConfig) {
  const compiled = compileOrchestratorPrompt(guidedConfig);

  if (!compiled) {
    return '# Preview\n\nConfigure your brand and scenarios to see the generated prompt.';
  }

  return compiled;
}

/**
 * Validates a guided configuration object
 * @param {Object} config - Configuration to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateGuidedConfig(config) {
  const errors = [];

  if (!config) {
    return { valid: true, errors: [] }; // Empty config is valid
  }

  if (config.brand) {
    if (config.brand.name && config.brand.name.length > 100) {
      errors.push('Brand name must be 100 characters or less');
    }

    if (config.brand.tone && !TONE_DESCRIPTIONS[config.brand.tone]) {
      errors.push(`Invalid tone: ${config.brand.tone}`);
    }
  }

  if (config.scenarios) {
    for (const key of Object.keys(config.scenarios)) {
      if (!SCENARIO_PROMPTS[key]) {
        errors.push(`Invalid scenario: ${key}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  compileOrchestratorPrompt,
  compilePromptPreview,
  validateGuidedConfig,
  sanitizeInput,
  TONE_DESCRIPTIONS,
  SCENARIO_PROMPTS,
};
