/**
 * Orchestrator Agent
 *
 * Coordinates the conversation analysis workflow:
 * 1. Fetches conversation and customer data using tools
 * 2. Dispatches to Sentiment and Intent specialist agents
 * 3. Matches detected topics to predefined Gladly topics
 * 4. Applies matching topics to the conversation
 * 5. Returns structured analysis results
 *
 * Uses Claude Sonnet for nuanced judgment and coordination.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { toolDefinitions, executeTool, formatToolResult } = require('../tools/gladly-tools');
const { runSentimentAgent } = require('./sentiment-agent');
const { runIntentAgent } = require('./intent-agent');

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
- complete_task: Signal when analysis is complete

## Your Workflow
1. Use get_conversation and get_conversation_items to fetch the conversation data
2. Use get_customer to understand the customer context
3. Analyze the conversation content for sentiment and intent (done automatically)
4. Use list_topics to see what predefined topics are available
5. Match detected topics to predefined Gladly topics
6. Use add_topic for each matching topic ID
7. Call complete_task with your structured results

## Important Rules
- ONLY apply topics that exist in Gladly (from list_topics)
- If no matching predefined topic exists, note it but continue
- Always call complete_task when finished
- Be thorough but efficient - minimize unnecessary tool calls

## Output Format
When calling complete_task, include structured results with:
- sentiment: { score, label, confidence, trajectory }
- intent: { primary_intent, detected_topics, matched_topics, urgency }
- topics_applied: array of topic IDs that were applied
- summary: brief description of the conversation`;

/**
 * Run the orchestrator agent
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

  // Agentic loop
  let maxIterations = 15;
  let iteration = 0;
  let analysisComplete = false;
  let finalResult = null;

  while (iteration < maxIterations && !analysisComplete) {
    iteration++;
    console.log(`[Orchestrator] Iteration ${iteration}/${maxIterations}`);

    try {
      const response = await anthropic.messages.create({
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

        // Process each tool call
        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          console.log(`[Orchestrator] Tool call: ${toolUse.name}`);

          // Special handling for specialist agents
          if (toolUse.name === 'analyze_sentiment') {
            // This would be called if we had it as a tool, but we'll handle inline
          }

          const result = await executeTool(toolUse.name, toolUse.input);
          console.log(`[Orchestrator] Tool result: ${result.success ? 'success' : 'error'}`);

          // Check if this is complete_task
          if (toolUse.name === 'complete_task') {
            analysisComplete = true;
            finalResult = result;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: formatToolResult(result)
          });
        }

        // Add tool results
        messages.push({ role: 'user', content: toolResults });

        // After getting conversation items, run specialist agents
        const itemsToolUse = toolUseBlocks.find(t => t.name === 'get_conversation_items');
        const topicsToolUse = toolUseBlocks.find(t => t.name === 'list_topics');

        if (itemsToolUse && !messages.some(m => m._hasAgentResults)) {
          // Get the items result
          const itemsResultIdx = toolResults.findIndex(r =>
            r.tool_use_id === itemsToolUse.id
          );
          if (itemsResultIdx >= 0) {
            const itemsData = JSON.parse(toolResults[itemsResultIdx].content);

            if (itemsData.success && itemsData.data) {
              console.log(`[Orchestrator] Running specialist agents...`);

              // Run sentiment and intent agents in parallel
              const [sentimentResult, intentResult] = await Promise.all([
                runSentimentAgent(itemsData.data),
                runIntentAgent(itemsData.data, topicsToolUse ? await getTopicsFromResult(toolResults, topicsToolUse.id) : [])
              ]);

              console.log(`[Orchestrator] Sentiment: ${sentimentResult.label} (${sentimentResult.score})`);
              console.log(`[Orchestrator] Intent: ${intentResult.primary_intent}`);
              console.log(`[Orchestrator] Matched topics: ${intentResult.matched_topic_ids?.join(', ') || 'none'}`);

              // Inject agent results into context
              messages.push({
                role: 'user',
                content: `Specialist agent analysis complete:

SENTIMENT ANALYSIS:
${JSON.stringify(sentimentResult, null, 2)}

INTENT ANALYSIS:
${JSON.stringify(intentResult, null, 2)}

Now apply the matched topics (matched_topic_ids) to the conversation using add_topic, then call complete_task with the full results.`,
                _hasAgentResults: true
              });
            }
          }
        }
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

/**
 * Extract topics data from tool results
 */
async function getTopicsFromResult(toolResults, toolUseId) {
  const result = toolResults.find(r => r.tool_use_id === toolUseId);
  if (result) {
    const data = JSON.parse(result.content);
    if (data.success && data.data) {
      return data.data;
    }
  }
  return [];
}

module.exports = { runOrchestrator };
