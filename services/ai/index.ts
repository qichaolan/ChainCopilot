/**
 * AI Services
 *
 * Backend services for AI interactions and prompt management.
 * Uses the prompt loader for dynamic prompt loading from markdown files.
 */

import {
  loadPrompt,
  loadPromptWithVariables,
  getSystemPrompt,
  getChainAnalysisPrompt,
  getStrategyAnalysisPrompt,
  getGreeksExplanationPrompt,
  type TemplateVariables,
} from '@/lib/ai/promptLoader';

import {
  COPILOT_INSTRUCTIONS,
  OPTIONS_ANALYSIS_PROMPT,
  STRATEGY_ANALYSIS_TEMPLATE,
} from '@/lib/ai/prompts';

// ============================================================================
// AI Service Class
// ============================================================================

/**
 * AI Service - handles prompt loading and AI-related utilities
 *
 * This service provides both static prompts (for client-side) and
 * dynamic prompt loading (for server-side with file-based prompts).
 */
export class AIService {
  /**
   * Get the base copilot instructions (static)
   */
  getCopilotInstructions(): string {
    return COPILOT_INSTRUCTIONS;
  }

  /**
   * Get system prompt from file (dynamic)
   */
  getSystemPromptFromFile(): string {
    return getSystemPrompt();
  }

  /**
   * Get options analysis prompt with context (static)
   */
  getOptionsAnalysisPrompt(context?: { symbol?: string; expiration?: string }): string {
    let prompt = OPTIONS_ANALYSIS_PROMPT;

    if (context?.symbol) {
      prompt = `Analyzing ${context.symbol} options chain.\n\n${prompt}`;
    }

    if (context?.expiration) {
      prompt = `${prompt}\n\nFocus on ${context.expiration} expiration.`;
    }

    return prompt;
  }

  /**
   * Get detailed chain analysis prompt from file (dynamic)
   * This loads the comprehensive chain_analysis.md prompt
   */
  getChainAnalysisPromptFromFile(): string {
    return getChainAnalysisPrompt();
  }

  /**
   * Get strategy-specific analysis prompt (static)
   */
  getStrategyPrompt(strategy: string): string {
    return STRATEGY_ANALYSIS_TEMPLATE(strategy);
  }

  /**
   * Get strategy analysis prompt from file (dynamic)
   */
  getStrategyPromptFromFile(strategy: string): string {
    return getStrategyAnalysisPrompt(strategy);
  }

  /**
   * Get Greeks explanation prompt from file
   */
  getGreeksPrompt(): string {
    return getGreeksExplanationPrompt();
  }

  /**
   * Load any prompt by name with optional variables
   */
  loadPromptByName(name: string, variables?: TemplateVariables): string {
    if (variables) {
      return loadPromptWithVariables(name, variables);
    }
    return loadPrompt(name);
  }

  /**
   * Build a complete prompt with context
   */
  buildPrompt(parts: {
    base?: string;
    context?: string;
    question?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const sections: string[] = [];

    if (parts.base) {
      sections.push(parts.base);
    }

    if (parts.context) {
      sections.push(`## Context\n${parts.context}`);
    }

    if (parts.metadata) {
      sections.push(`## Metadata\n\`\`\`json\n${JSON.stringify(parts.metadata, null, 2)}\n\`\`\``);
    }

    if (parts.question) {
      sections.push(`## User Question\n${parts.question}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Build a chain analysis prompt with options data
   */
  buildChainAnalysisPrompt(data: {
    symbol: string;
    expiration: string;
    underlyingPrice: number;
    optionMetadata: Record<string, unknown>;
  }): string {
    const basePrompt = this.getChainAnalysisPromptFromFile();

    return this.buildPrompt({
      base: basePrompt,
      context: `Analyzing ${data.symbol} options chain for ${data.expiration} expiration. Current underlying price: $${data.underlyingPrice.toFixed(2)}`,
      metadata: data.optionMetadata,
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const aiService = new AIService();

// ============================================================================
// Re-exports
// ============================================================================

// Static prompts (client-safe)
export {
  COPILOT_INSTRUCTIONS,
  OPTIONS_ANALYSIS_PROMPT,
  STRATEGY_ANALYSIS_TEMPLATE,
  CHAT_WELCOME_MESSAGE,
} from '@/lib/ai/prompts';

// Prompt loader utilities
export {
  loadPrompt,
  loadPromptWithVariables,
  PROMPT_NAMES,
  type TemplateVariables,
} from '@/lib/ai/promptLoader';
