/**
 * AI Context Configuration
 *
 * Centralized limits and constraints for data sent to CopilotKit AI.
 * These caps prevent large payloads while ensuring AI has enough context.
 */

export const AI_CONTEXT_CONFIG = {
  // Chain view constraints
  chain: {
    /** Max strikes to include in visibleStrikes array */
    maxStrikes: 40,
  },

  // Heatmap view constraints
  heatmap: {
    /** Max cells to include in topCells array */
    topCellsCount: 12,
  },

  // Tornado view constraints
  tornado: {
    /** Max strikes to include in distribution.byStrike array */
    maxStrikes: 50,
  },
} as const;

// Type exports for consumers
export type AIContextConfig = typeof AI_CONTEXT_CONFIG;
