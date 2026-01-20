/**
 * Orchestrator Agent
 *
 * Coordinates the conversation analysis workflow using tool-based composition:
 * 1. Fetches conversation and customer data using tools
 * 2. Calls analyze_sentiment and analyze_intent tools (specialist agents exposed as tools)
 * 3. Matches detected topics to predefined Gladly topics
 * 4. Applies matching topics to the conversation
 * 5. Returns structured analysis results
 *
 * Following agent-native principles, specialist agents are exposed as tools
 * so the orchestrator decides when to invoke them via prompts rather than
 * hardcoded dispatch logic.
 *
 * Uses Claude Sonnet for nuanced judgment and coordination.
 *
 * ============================================================================
 * ARCHITECTURE DECISION: Agentic Loop (Intentional Design)
 * ============================================================================
 *
 * This orchestrator uses an agentic loop intentionally for agent-native flexibility:
 *
 * - Agent decides which tools to call based on conversation content
 *   The LLM can adapt the workflow dynamically based on what it observes,
 *   rather than following a rigid sequence of function calls.
 *
 * - Enables future extensions (e.g., skip analysis for simple greetings)
 *   The agent can make intelligent decisions like skipping expensive analysis
 *   for trivial conversations or escalating complex ones differently.
 *
 * - Supports self-correcting behavior if initial analysis is poor
 *   If the agent detects low confidence results, it can retry or adjust
 *   its approach without code changes.
 *
 * - New analysis types can be added via prompt changes, not code
 *   Adding new capabilities (e.g., urgency detection, language identification)
 *   requires only prompt updates, not new function implementations.
 *
 * The tradeoff of extra iterations is worth the composability benefit.
 *
 * Alternative considered: Direct function calls with Promise.all() for parallel
 * fetching. While simpler and faster for the current fixed workflow, it loses
 * the agent-native flexibility that makes this architecture extensible.
 *
 * See: todos/013-ready-p3-over-engineered-orchestrator.md for full analysis.
 * ============================================================================
 */

const Anthropic = require('@anthropic-ai/sdk');
const { toolDefinitions, executeTool, formatToolResult } = require('../tools/gladly-tools');
const { rateLimitedClaudeCall } = require('../utils/claude-limiter');

const anthropic = new Anthropic();

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an AI orchestrator analyzing Gladly customer service conversations.

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
- complete_task: Signal when analysis is complete

## Your Workflow
1. Use get_conversation and get_conversation_items to fetch the conversation data
2. Use get_customer to understand the customer context
3. Use list_topics to see what predefined topics are available
4. Use analyze_sentiment with the conversation content (as JSON string) to get sentiment analysis
5. Use analyze_intent with conversation content (as JSON string) and available topics to classify intent
6. Use add_topic for each matched topic ID from the intent analysis
7. Call complete_task with your structured results

## Important Rules
- ONLY apply topics that exist in Gladly (from list_topics)
- If no matching predefined topic exists, note it but continue
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
 * Run the orchestrator agent
 *
 * This function implements the agentic loop that coordinates conversation analysis.
 * The loop allows the agent to dynamically decide which tools to call and in what
 * order, providing flexibility for future enhancements without code changes.
 *
 * @param {object} context - Analysis context
 * @param {string} context.eventType - CONVERSATION/CREATED or CONVERSATION/CLOSED
 * @param {string} context.conversationId - Gladly conversation ID
 * @param {string} context.customerId - Gladly customer ID
 * @returns {Promise<object>} Analysis results
 */
async function runOrchestrator(context) {
  const { eventType, conversationId, customerId } = context;

  console.log(`[Orchestrator] Starting analysis for conversation ${conversationId}`);

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

  // Agentic loop - intentionally used for flexibility (see file header for rationale)
  // The agent decides tool execution order based on conversation content
  let maxIterations = 15;
  let iteration = 0;
  let analysisComplete = false;
  let finalResult = null;

  while (iteration < maxIterations && !analysisComplete) {
    iteration++;
    console.log(`[Orchestrator] Iteration ${iteration}/${maxIterations}`);

    try {
      const response = await rateLimitedClaudeCall(anthropic, {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages
      });

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        // Model finished without tool use
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
        // Process tool calls
        const toolUseBlocks = response.content.filter(c => c.type === 'tool_use');

        // Add assistant message
        messages.push({ role: 'assistant', content: response.content });

        // Execute all tool calls in parallel for efficiency
        // The agent determines which tools to call; we optimize execution
        console.log(`[Orchestrator] Executing ${toolUseBlocks.length} tool call(s) in parallel`);
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (toolUse) => {
            console.log(`[Orchestrator] Tool call: ${toolUse.name}`);

            const result = await executeTool(toolUse.name, toolUse.input);
            console.log(`[Orchestrator] Tool result for ${toolUse.name}: ${result.success ? 'success' : 'error'}`);

            // Log warnings for agent failures (result envelopes with fallbacks)
            if (!result.success) {
              if (toolUse.name === 'analyze_sentiment') {
                console.warn(`[Orchestrator] Sentiment analysis failed:`, result.error);
                console.warn(`[Orchestrator] Using fallback sentiment data`);
              } else if (toolUse.name === 'analyze_intent') {
                console.warn(`[Orchestrator] Intent analysis failed:`, result.error);
                console.warn(`[Orchestrator] Using fallback intent data`);
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

  return finalResult;
}

module.exports = { runOrchestrator };
