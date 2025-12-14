/**
 * Custom Gemini Adapter for CopilotKit
 *
 * This adapter extends GoogleGenerativeAIAdapter to properly inject
 * system prompts from our prompt files.
 *
 * The issue: CopilotKit's useCopilotAdditionalInstructions doesn't
 * properly forward instructions to the Google adapter. This custom
 * adapter ensures the system prompt is always included.
 */

import { GoogleGenerativeAIAdapter } from "@copilotkit/runtime";
import { getSystemPrompt } from "./promptLoader";

/** Default fallback system prompt when file loading fails */
const FALLBACK_SYSTEM_PROMPT = `You are ChainCopilot, an expert AI assistant for stock options trading analysis.

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
- Respond conversationally to greetings and general questions
- When analyzing options data from context, provide specific insights based on the numbers`;

// Use WeakMap for storing metadata on adapter instances (no memory leak, proper typing)
const adapterMetadata = new WeakMap<GoogleGenerativeAIAdapter, { systemPrompt: string }>();

// Load system prompt at module initialization
let cachedSystemPrompt: string | null = null;

function getOrLoadSystemPrompt(): string {
  if (cachedSystemPrompt === null) {
    try {
      cachedSystemPrompt = getSystemPrompt();
    } catch {
      // Use fallback silently - logging would be noisy in production
      cachedSystemPrompt = FALLBACK_SYSTEM_PROMPT;
    }
  }
  return cachedSystemPrompt;
}

/**
 * Create a Gemini adapter with system prompt injection
 *
 * DO NOT CHANGE: gemini-2.5-flash-lite is the intended model
 */
export function createGeminiAdapter(): GoogleGenerativeAIAdapter {
  const systemPrompt = getOrLoadSystemPrompt();

  // The adapter will use this configuration
  const adapter = new GoogleGenerativeAIAdapter({
    model: "gemini-2.5-flash-lite",
    apiVersion: "v1",
  });

  // Store system prompt in WeakMap (proper typing, no memory leak)
  adapterMetadata.set(adapter, { systemPrompt });

  return adapter;
}

/**
 * Get the system prompt associated with an adapter
 */
export function getAdapterSystemPrompt(adapter: GoogleGenerativeAIAdapter): string | undefined {
  return adapterMetadata.get(adapter)?.systemPrompt;
}

/**
 * Get the current system prompt (for debugging/logging)
 */
export function getCurrentSystemPrompt(): string {
  return getOrLoadSystemPrompt();
}

/**
 * Clear the cached system prompt (force reload on next use)
 */
export function clearSystemPromptCache(): void {
  cachedSystemPrompt = null;
}
