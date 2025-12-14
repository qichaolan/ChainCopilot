/**
 * AI Module Exports
 *
 * Central export point for all AI-related utilities.
 */

// Static prompts (client-safe)
export {
  COPILOT_INSTRUCTIONS,
  CHAT_WELCOME_MESSAGE,
  OPTIONS_ANALYSIS_PROMPT,
  STRATEGY_ANALYSIS_TEMPLATE,
  PROMPT_FILES,
} from './prompts';

// Prompt loader (server-side only - uses fs)
// WARNING: Only import these in server-side code (API routes, server components)
export {
  loadPrompt,
  loadPromptWithVariables,
  loadPromptSafe,
  loadPrompts,
  getPromptPath,
  promptExists,
  isValidPromptName,
  listPrompts,
  clearPromptCache,
  reloadPrompt,
  getCacheStats,
  getSystemPrompt,
  getWelcomeMessage,
  getChainAnalysisPrompt,
  getStrategyAnalysisPrompt,
  getGreeksExplanationPrompt,
  PROMPT_NAMES,
  type PromptName,
  type PromptMetadata,
  type LoadedPrompt,
  type TemplateVariables,
} from './promptLoader';
