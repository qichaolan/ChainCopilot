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
- Risk/reward analysis and probability of profit
- Market sentiment and unusual options activity
- Entry/exit timing and position sizing

Guidelines:
- Be concise and data-driven
- Always emphasize risk management
- Format numbers clearly and use bullet points for key metrics
- Respond conversationally to greetings and general questions`;

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
