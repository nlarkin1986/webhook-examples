/**
 * Tenant-Aware Orchestrator Agent
 *
 * Coordinates conversation analysis using tenant-specific configuration:
 * - Uses tenant's configured model (orchestrator_model)
 * - Uses tenant's custom system prompt if provided
 * - Only enables tools that tenant has enabled
 * - Respects tenant behavior settings (auto_apply_topics, add_analysis_note)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getEnabledToolDefinitions, createToolExecutor, formatToolResult } = require('../tools/gladly-tools-tenant');
const { rateLimitedClaudeCall } = require('../utils/claude-limiter');
const { extractAndStoreFeedback } = require('../services/feedback-extractor');

const anthropic = new Anthropic();

/**
 * Default orchestrator system prompt
 * Used when tenant has not configured a custom prompt
 */
const DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT = `You are an AI orchestrator analyzing Gladly customer service conversations.

## Your Role
You coordinate specialist agents and tools to analyze conversations, classify them, and apply appropriate topics.

## Available Tools
- get_conversation: Read conversation metadata (status, inbox, timestamps)
- get_conversation_items: Read all messages in the conversation
- get_customer: Read customer profile (name, emails, phones, attributes)
- list_topics: List all predefined Gladly topics available
- add_topic: Add a predefined topic to the conversation
- remove_topic: Remove a topic from the conversation
- analyze_sentiment: Run sentiment analysis on conversation messages
- analyze_intent: Classify customer intent and match to available topics
- add_note: Add a note to the conversation documenting the analysis
- complete_task: Signal when analysis is complete

## Your Workflow
1. Use get_conversation and get_conversation_items to fetch the conversation data
2. Use get_customer to understand the customer context
3. Use list_topics to see what predefined topics are available
4. Use analyze_sentiment with the conversation content (as JSON string) to get sentiment analysis
5. Use analyze_intent with conversation content (as JSON string) and available topics to classify intent
6. Use add_topic for each matched topic ID from the intent analysis
7. REQUIRED: Use add_note to post a summary note to the conversation including:
   - Sentiment: label and score (e.g., "positive (0.7)")
   - Trajectory: whether sentiment improved, declined, or stayed stable
   - Primary Intent: the main customer intent
   - Topics Applied: names of topics that were added
8. Call complete_task with your structured results

## Important Rules
- ONLY apply topics that exist in Gladly (from list_topics)
- If no matching predefined topic exists, note it but continue
- ALWAYS call add_note before complete_task - this is required for both new and closed conversations
- Always call complete_task when finished
- Be thorough but efficient - minimize unnecessary tool calls
- You decide when to run sentiment and intent analysis - use them when you have conversation data
- For analyze_sentiment and analyze_intent, pass conversation_content as a JSON string of the items

## Output Format
When calling complete_task, include structured results with:
- sentiment: { score, label, confidence, trajectory }
- intent: { primary_intent, detected_topics, matched_topics, urgency }
- topics_applied: array of topic IDs that were applied
- summary: brief description of the conversation`;

/**
 * Run the tenant-aware orchestrator agent
 *
 * @param {object} context - Analysis context
 * @param {string} context.eventType - CONVERSATION/CREATED or CONVERSATION/CLOSED
 * @param {string} context.conversationId - Gladly conversation ID
 * @param {string} context.customerId - Gladly customer ID
 * @param {object} context.tenant - Tenant context from middleware
 * @returns {Promise<object>} Analysis results
 */
async function runOrchestratorWithTenant(context) {
  const { eventType, conversationId, customerId, tenant } = context;
  const config = tenant.config || {};

  console.log(`[Orchestrator] Starting analysis for conversation ${conversationId} (tenant: ${tenant.slug})`);

  // Get tenant's model selection (default to Sonnet)
  const model = config.orchestratorModel || 'claude-sonnet-4-20250514';

  // Get tenant's custom prompt or use default
  const systemPrompt = config.orchestratorSystemPrompt || DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT;

  // Get enabled tools based on tenant config
  const enabledTools = getEnabledToolDefinitions(config);
  console.log(`[Orchestrator] Using model: ${model}, enabled tools: ${enabledTools.map(t => t.name).join(', ')}`);

  // Create tool executor bound to this tenant
  const executeTool = createToolExecutor(tenant);

  // Initial prompt includes context
  const initialPrompt = `Analyze this Gladly conversation.

Context:
- Event Type: ${eventType}
- Conversation ID: ${conversationId}
- Customer ID: ${customerId}

${eventType === 'CONVERSATION/CREATED'
    ? 'This is a newly created conversation. Perform initial analysis with available data.'
    : 'This conversation has been closed. Perform full analysis of the complete conversation.'}

Start by fetching the conversation data, then analyze and apply appropriate topics.`;

  const messages = [{ role: 'user', content: initialPrompt }];

  // Agentic loop
  let maxIterations = 15;
  let iteration = 0;
  let analysisComplete = false;
  let finalResult = null;

  while (iteration < maxIterations && !analysisComplete) {
    iteration++;
    console.log(`[Orchestrator] Iteration ${iteration}/${maxIterations} (tenant: ${tenant.slug})`);

    try {
      const response = await rateLimitedClaudeCall(anthropic, {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: enabledTools,
        messages
      });

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        const textContent = response.content.find(c => c.type === 'text');
        console.log(`[Orchestrator] Agent completed without tool call`);
        finalResult = {
          success: true,
          summary: textContent?.text || 'Analysis completed',
          results: {}
        };
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(c => c.type === 'tool_use');

        // Add assistant message
        messages.push({ role: 'assistant', content: response.content });

        // Execute all tool calls in parallel
        console.log(`[Orchestrator] Executing ${toolUseBlocks.length} tool call(s) in parallel`);
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (toolUse) => {
            console.log(`[Orchestrator] Tool call: ${toolUse.name}`);

            const result = await executeTool(toolUse.name, toolUse.input);
            console.log(`[Orchestrator] Tool result for ${toolUse.name}: ${result.success ? 'success' : 'error'}`);

            // Log warnings for agent failures
            if (!result.success) {
              if (toolUse.name === 'analyze_sentiment') {
                console.warn(`[Orchestrator] Sentiment analysis failed:`, result.error);
              } else if (toolUse.name === 'analyze_intent') {
                console.warn(`[Orchestrator] Intent analysis failed:`, result.error);
              }
            }

            // Check if this is complete_task
            if (toolUse.name === 'complete_task') {
              analysisComplete = true;
              finalResult = result;
            }

            return {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: formatToolResult(result)
            };
          })
        );

        // Add tool results
        messages.push({ role: 'user', content: toolResults });
      }

    } catch (error) {
      console.error(`[Orchestrator] Error in iteration ${iteration}:`, error.message);
      throw error;
    }
  }

  if (!finalResult) {
    finalResult = {
      success: false,
      summary: 'Analysis did not complete within iteration limit',
      results: {}
    };
  }

  // Trigger Customer Intelligence extraction if enabled
  if (config.intelligenceEnabled && finalResult.success) {
    try {
      console.log(`[Orchestrator] Triggering intelligence extraction for conversation ${conversationId}`);

      // Get conversation items for intelligence extraction
      const conversationItems = finalResult.results?.conversationItems || [];

      // Extract and store feedback asynchronously (don't block the response)
      extractAndStoreFeedback(tenant.id, conversationId, conversationItems, {
        analysisResults: finalResult.results
      }).then(feedbackResult => {
        if (feedbackResult.success) {
          console.log(`[Orchestrator] Intelligence extraction completed: ${feedbackResult.feedbackId}`);
        } else {
          console.warn(`[Orchestrator] Intelligence extraction failed:`, feedbackResult.error);
        }
      }).catch(error => {
        console.error(`[Orchestrator] Intelligence extraction error:`, error.message);
      });
    } catch (error) {
      // Don't fail the main analysis if intelligence extraction fails
      console.error(`[Orchestrator] Failed to trigger intelligence extraction:`, error.message);
    }
  }

  return finalResult;
}

module.exports = { runOrchestratorWithTenant, DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT };
