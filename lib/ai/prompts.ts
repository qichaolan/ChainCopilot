/**
 * Centralized AI Prompts
 *
 * This module provides both static prompt exports (for client-side use)
 * and dynamic loading functions (for server-side use).
 *
 * For server-side code that needs to load prompts from files,
 * use the promptLoader module directly.
 */

// ============================================================================
// Static Prompts (Client-Safe)
// These are embedded in the bundle and work on both client and server
// ============================================================================

/**
 * Main ChainCopilot assistant instructions
 * Used by the chat orchestrator for options trading analysis
 */
export const COPILOT_INSTRUCTIONS = `You are ChainCopilot, an expert AI assistant for stock options trading analysis.

Your expertise includes:
- Options chain data and Greeks (Delta, Gamma, Theta, Vega, IV)
- Trading strategies (covered calls, cash-secured puts, spreads, iron condors, straddles)
- LEAPS (Long-Term Equity AnticiPation Securities) - options with 6+ months to expiration
- Risk/reward analysis and probability of profit
- Market sentiment and unusual options activity
- Entry/exit timing and position sizing

Guidelines:
- Be concise and data-driven
- Always emphasize risk management
- Format numbers clearly and use bullet points for key metrics
- Respond conversationally to greetings and general questions

IMPORTANT - Use Actions for Rich Display:
When displaying options data, metrics, analysis, or strategies, you MUST use the available actions to render rich UI components instead of plain text. The actions are:

For general options:
- displayMetrics: Show key metrics in a visual card (use for IV, volume, ratios, prices)
- displayAnalysis: Show detailed analysis with sections (use for market analysis, trade evaluation)
- displayStrategy: Show strategy information (use for explaining strategies like spreads, condors)

For LEAPS analysis:
- buildLEAPS: Use this when user wants to find/build LEAPS positions. Pass symbol, direction (bullish/bearish), and optional capitalBudget.
- displayLeapsFilter: Show LEAPS filter results with passed/excluded counts
- displayLeapsRanking: Show ranked LEAPS candidates with scores
- displayLeapsPayoff: Show payoff simulation with scenarios and theta decay
- displayLeapsRisk: Show risk assessment with IV rank, warnings, recommendations

When user asks about LEAPS, long-term options, or stock replacement strategies, use the buildLEAPS action with dataJson containing mock data for the current step. Always prefer actions over plain text for data display.`;

/**
 * Welcome message shown when chat opens
 */
export const CHAT_WELCOME_MESSAGE =
  "Hi! I'm your AI options trading assistant. Ask me about options strategies, market analysis, or specific trades.";

/**
 * Basic options analysis prompt (static version)
 */
export const OPTIONS_ANALYSIS_PROMPT = `Analyze the provided options chain data and provide insights on:
1. Notable strike prices with high volume or open interest
2. Implied volatility patterns (skew analysis)
3. Potential trading opportunities based on Greeks
4. Risk assessment for various strategies

Format your response with clear sections and bullet points.`;

/**
 * Strategy analysis template function (static version)
 */
export const STRATEGY_ANALYSIS_TEMPLATE = (strategy: string) => `
Analyze the ${strategy} strategy for the given options chain:
- Entry criteria and optimal strikes
- Risk/reward profile
- Break-even points
- Greeks exposure
- Key risks and how to manage them
`;

// ============================================================================
// Prompt Names (for use with promptLoader)
// ============================================================================

export const PROMPT_FILES = {
  SYSTEM: 'system',
  CHAIN_ANALYSIS: 'chain_analysis',
  STRATEGY_ANALYSIS: 'strategy_analysis',
  WELCOME: 'welcome',
  GREEKS_EXPLANATION: 'greeks_explanation',
} as const;

// ============================================================================
// Re-exports from promptLoader (Server-Side Only)
// Import these directly from promptLoader for server-side use
// ============================================================================

// Note: The following are available from '@/lib/ai/promptLoader':
// - loadPrompt(name)
// - loadPromptWithVariables(name, variables)
// - getSystemPrompt()
// - getChainAnalysisPrompt()
// - getStrategyAnalysisPrompt(strategy)
// - getWelcomeMessage()
// - getGreeksExplanationPrompt()
