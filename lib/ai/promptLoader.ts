/**
 * Prompt Loader
 *
 * Utility for loading and managing AI prompts from markdown files.
 * Supports template variables and caching for performance.
 *
 * IMPORTANT: This module uses Node.js fs and should only be imported
 * in server-side code (API routes, server components). Do NOT use in
 * client components or Edge runtime.
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Server-Only Guard
// ============================================================================

if (typeof window !== 'undefined') {
  throw new Error(
    '[PromptLoader] This module can only be used on the server. ' +
      'Do not import it in client components.'
  );
}

// ============================================================================
// Types
// ============================================================================

export interface PromptMetadata {
  name: string;
  path: string;
  lastModified?: Date;
}

export interface LoadedPrompt {
  name: string;
  content: string;
  metadata: PromptMetadata;
}

export type TemplateVariables = Record<string, string | number>;

interface CacheEntry {
  content: string;
  mtimeMs: number;
  filePath: string;
}

// ============================================================================
// Constants
// ============================================================================

// Use __dirname fallback for environments where cwd differs
const PROMPTS_DIR = path.resolve(process.cwd(), 'lib', 'ai', 'prompts');

// Available prompt names (without .md extension) - whitelist for security
export const PROMPT_NAMES = {
  SYSTEM: 'system',
  CHAIN_ANALYSIS: 'chain_analysis',
  STRATEGY_ANALYSIS: 'strategy_analysis',
  WELCOME: 'welcome',
  GREEKS_EXPLANATION: 'greeks_explanation',
  FUNDAMENTAL: 'fundamental',
} as const;

export type PromptName = (typeof PROMPT_NAMES)[keyof typeof PROMPT_NAMES];

// Set of valid prompt names for whitelist validation
const VALID_PROMPT_NAMES = new Set(Object.values(PROMPT_NAMES));

// ============================================================================
// Cache (mtime-based for automatic invalidation)
// ============================================================================

const promptCache = new Map<string, CacheEntry>();

// ============================================================================
// Security Helpers
// ============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate that a resolved path is within the prompts directory
 * Prevents path traversal attacks
 */
function validatePath(resolvedPath: string): boolean {
  const normalizedPrompts = path.normalize(PROMPTS_DIR);
  const normalizedResolved = path.normalize(resolvedPath);

  // Ensure the resolved path starts with the prompts directory
  return normalizedResolved.startsWith(normalizedPrompts + path.sep);
}

/**
 * Validate prompt name against whitelist
 * For external/untrusted input, use this to ensure only known prompts are loaded
 */
export function isValidPromptName(name: string): name is PromptName {
  return VALID_PROMPT_NAMES.has(name as PromptName);
}

/**
 * Sanitize prompt name - remove path separators and validate
 */
function sanitizePromptName(name: string): string {
  // Remove any path separators or parent directory references
  return path.basename(name).replace(/\.md$/i, '');
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the file path for a prompt by name (with security validation)
 */
export function getPromptPath(name: PromptName | string): string {
  const sanitizedName = sanitizePromptName(name);
  const filePath = path.resolve(PROMPTS_DIR, `${sanitizedName}.md`);

  // Validate path doesn't escape prompts directory
  if (!validatePath(filePath)) {
    throw new Error(`[PromptLoader] Invalid prompt path: ${name}`);
  }

  return filePath;
}

/**
 * Check if a prompt file exists
 */
export function promptExists(name: PromptName | string): boolean {
  try {
    const filePath = getPromptPath(name);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Load a prompt from file (with mtime-based caching)
 *
 * Cache invalidates automatically when file is modified.
 */
export function loadPrompt(name: PromptName | string): string {
  const filePath = getPromptPath(name);
  const cacheKey = filePath; // Use full path as cache key to avoid collisions

  try {
    const stats = fs.statSync(filePath);
    const cached = promptCache.get(cacheKey);

    // Return cached if file hasn't changed (mtime-based invalidation)
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.content;
    }

    // Load from file
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const content = processPromptContent(rawContent);

    // Cache with mtime for automatic invalidation
    promptCache.set(cacheKey, {
      content,
      mtimeMs: stats.mtimeMs,
      filePath,
    });

    return content;
  } catch (error) {
    console.error(`[PromptLoader] Failed to load prompt "${name}":`, error);
    throw new Error(`Prompt not found: ${name}`);
  }
}

/**
 * Process prompt content - strip title if present, handle frontmatter
 */
function processPromptContent(rawContent: string): string {
  const lines = rawContent.split('\n');

  // Check for YAML frontmatter (starts with ---)
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
    if (endIndex > 0) {
      // Skip frontmatter
      lines.splice(0, endIndex + 1);
    }
  }

  // Strip markdown title only if it's a proper title (# followed by space and text)
  if (lines[0] && /^#\s+\S/.test(lines[0])) {
    lines.shift();
  }

  return lines.join('\n').trim();
}

/**
 * Load a prompt and apply template variables
 *
 * Variables in the prompt should be in {{variableName}} format.
 * Keys are escaped to prevent regex injection.
 */
export function loadPromptWithVariables(
  name: PromptName | string,
  variables: TemplateVariables
): string {
  let content = loadPrompt(name);

  // Replace template variables with escaped keys
  for (const [key, value] of Object.entries(variables)) {
    // Escape regex metacharacters in the key to prevent injection
    const escapedKey = escapeRegExp(key);
    const pattern = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
    content = content.replace(pattern, String(value));
  }

  return content;
}

/**
 * Load a prompt safely from untrusted input
 * Only allows whitelisted prompt names
 */
export function loadPromptSafe(name: string): string {
  if (!isValidPromptName(name)) {
    throw new Error(`[PromptLoader] Unknown prompt name: ${name}`);
  }
  return loadPrompt(name);
}

/**
 * Load multiple prompts and combine them
 */
export function loadPrompts(names: (PromptName | string)[]): string {
  return names.map(name => loadPrompt(name)).join('\n\n');
}

/**
 * List all available prompts
 */
export function listPrompts(): PromptMetadata[] {
  try {
    const files = fs.readdirSync(PROMPTS_DIR);

    return files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const filePath = path.join(PROMPTS_DIR, file);
        const stats = fs.statSync(filePath);

        return {
          name: file.replace('.md', ''),
          path: filePath,
          lastModified: stats.mtime,
        };
      });
  } catch (error) {
    console.error('[PromptLoader] Failed to list prompts:', error);
    return [];
  }
}

/**
 * Clear the prompt cache
 */
export function clearPromptCache(): void {
  promptCache.clear();
}

/**
 * Reload a specific prompt (clear from cache and reload)
 */
export function reloadPrompt(name: PromptName | string): string {
  const filePath = getPromptPath(name);
  promptCache.delete(filePath);
  return loadPrompt(name);
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: promptCache.size,
    entries: Array.from(promptCache.keys()),
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the system prompt for the copilot
 */
export function getSystemPrompt(): string {
  return loadPrompt(PROMPT_NAMES.SYSTEM);
}

/**
 * Get the welcome message
 */
export function getWelcomeMessage(): string {
  return loadPrompt(PROMPT_NAMES.WELCOME);
}

/**
 * Get the chain analysis prompt
 */
export function getChainAnalysisPrompt(): string {
  return loadPrompt(PROMPT_NAMES.CHAIN_ANALYSIS);
}

/**
 * Get the strategy analysis prompt with strategy name
 */
export function getStrategyAnalysisPrompt(strategy: string): string {
  return loadPromptWithVariables(PROMPT_NAMES.STRATEGY_ANALYSIS, { strategy });
}

/**
 * Get the Greeks explanation prompt
 */
export function getGreeksExplanationPrompt(): string {
  return loadPrompt(PROMPT_NAMES.GREEKS_EXPLANATION);
}

/**
 * Get the fundamental analysis prompt for SEC filings
 */
export function getFundamentalPrompt(): string {
  return loadPrompt(PROMPT_NAMES.FUNDAMENTAL);
}
