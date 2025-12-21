"use client";

/**
 * Filing Context Provider
 *
 * Manages state for the SEC filing viewer including:
 * - Active company and filing
 * - Selected section
 * - View mode (clean/as-filed)
 * - CopilotKit readable context
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useCopilotReadable, useCopilotAction, useCopilotAdditionalInstructions } from "@copilotkit/react-core";
import {
  FilingManifest,
  FilingSection,
  FilingContext as FilingContextType,
  SectionContent,
  SearchResult,
  AskFilingResult,
} from "@/lib/sec/types";

interface FilingProviderState {
  // Current filing state
  manifest: FilingManifest | null;
  selectedSectionId: string | null;
  viewMode: "clean" | "asFiled";
  sectionContent: SectionContent | null;
  isLoadingSection: boolean;

  // Chat panel state
  isChatOpen: boolean;
  chatWidth: number;

  // Actions
  setManifest: (manifest: FilingManifest | null) => void;
  selectSection: (sectionId: string, filingIdOverride?: string) => void;
  setViewMode: (mode: "clean" | "asFiled") => void;
  highlightAnchor: (sectionId: string, anchorId?: string) => void;
  setIsChatOpen: (open: boolean) => void;
  setChatWidth: (width: number) => void;
}

const FilingStateContext = createContext<FilingProviderState | null>(null);

// Default chat panel width
const DEFAULT_CHAT_WIDTH = 384;

// Helper to safely access localStorage
function getStoredValue<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStoredValue<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors
  }
}

export function FilingProvider({ children }: { children: React.ReactNode }) {
  const [manifest, setManifest] = useState<FilingManifest | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"clean" | "asFiled">("clean");
  const [sectionContent, setSectionContent] = useState<SectionContent | null>(null);
  const [isLoadingSection, setIsLoadingSection] = useState(false);
  const [highlightedAnchor, setHighlightedAnchor] = useState<{
    sectionId: string;
    anchorId?: string;
  } | null>(null);

  // Chat panel state with localStorage persistence
  const [isChatOpen, setIsChatOpenState] = useState(() =>
    getStoredValue("filing-chat-open", true)
  );
  const [chatWidth, setChatWidthState] = useState(() =>
    getStoredValue("filing-chat-width", DEFAULT_CHAT_WIDTH)
  );

  // Persist chat state to localStorage
  const setIsChatOpen = useCallback((open: boolean) => {
    setIsChatOpenState(open);
    setStoredValue("filing-chat-open", open);
  }, []);

  const setChatWidth = useCallback((width: number) => {
    const clampedWidth = Math.max(200, Math.min(600, width));
    setChatWidthState(clampedWidth);
    setStoredValue("filing-chat-width", clampedWidth);
  }, []);

  // Build copilot readable context
  const filingContext: FilingContextType = {
    activeCompany: manifest
      ? {
          ticker: manifest.ticker,
          cik: manifest.cik,
          name: manifest.company_name,
        }
      : null,
    activeFiling: manifest
      ? {
          filingId: `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}`,
          formType: manifest.form_type,
          filedAt: manifest.filed_at,
          reportPeriod: manifest.report_period,
        }
      : null,
    toc: manifest?.sections || [],
    uiState: {
      selectedSectionId,
      viewMode,
      highlightedText: null,
      searchQuery: null,
    },
  };

  // Register copilot readable context
  useCopilotReadable({
    description:
      "SEC filing context currently being viewed. Use the available actions to fetch full section text, search, or ask questions about the filing.",
    value: filingContext,
  });

  // Register currently displayed section content for AI visibility
  // Always provide an object so AI knows the context exists
  useCopilotReadable({
    description:
      "CURRENT_SECTION_CONTENT: The SEC filing section text currently displayed to the user. When user asks to summarize 'this page', 'what I'm reading', or 'this section', use the sectionText field directly.",
    value: {
      isLoaded: !!sectionContent,
      sectionId: sectionContent?.section.id || null,
      sectionLabel: sectionContent?.section.label || null,
      sectionText: sectionContent?.section.text || null,
      charCount: sectionContent ? sectionContent.section.char_end - sectionContent.section.char_start : 0,
      wordCount: sectionContent ? sectionContent.section.text.split(/\s+/).length : 0,
    },
  });

  // Add AI instructions for filing analysis
  useCopilotAdditionalInstructions({
    instructions: `You are a financial analyst expert helping users analyze SEC filings (10-K and 10-Q reports).

## CRITICAL: How to Access Filing Content

You have TWO readable contexts available:
1. "SEC filing context" - contains filing metadata, company info, and table of contents
2. "CURRENT_SECTION_CONTENT" - contains the actual text the user is currently viewing

### When user asks "summarize this page" or "what am I reading":
1. Look at the CURRENT_SECTION_CONTENT readable context
2. Check if isLoaded is true
3. If true, read the sectionText field - this IS the content they're viewing
4. Summarize that sectionText directly - DO NOT call any tools

### Example of what you'll see in CURRENT_SECTION_CONTENT:
{
  "isLoaded": true,
  "sectionId": "item_1a",
  "sectionLabel": "Item 1A. Risk Factors",
  "sectionText": "The actual filing text content here...",
  "wordCount": 5000
}

If isLoaded is false, tell the user to select a section first.

## Available Tools (use only when needed):
- getFilingSection(sectionId): Get a DIFFERENT section (not current one)
- searchFiling(query): Search across the entire filing
- navigateToSection(sectionId): Navigate UI to a section

## Guidelines:
- Be concise and cite section names
- Highlight material risks and key financial metrics
- For current section questions, use sectionText directly without calling tools`,
  });

  // Load section content when selection changes
  const selectSection = useCallback(
    async (sectionId: string, filingIdOverride?: string) => {
      setSelectedSectionId(sectionId);

      // Use override filingId if provided (for initial load before manifest state updates)
      const filingId = filingIdOverride ||
        (manifest ? `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}` : null);

      if (!filingId) return;

      setIsLoadingSection(true);

      try {
        // Request HTML format to get nicely formatted section content
        const response = await fetch(
          `/api/filings/${filingId}/section/${sectionId}?format=html`
        );
        if (response.ok) {
          const data = await response.json();
          setSectionContent(data);
        } else {
          console.error("Failed to load section:", response.status);
        }
      } catch (error) {
        console.error("Error loading section:", error);
      } finally {
        setIsLoadingSection(false);
      }
    },
    [manifest]
  );

  // Highlight and scroll to anchor
  const highlightAnchor = useCallback(
    (sectionId: string, anchorId?: string) => {
      setHighlightedAnchor({ sectionId, anchorId });
      // If different section, load it first
      if (sectionId !== selectedSectionId) {
        selectSection(sectionId);
      }
      // Scroll to anchor after a short delay
      setTimeout(() => {
        if (anchorId) {
          const element = document.getElementById(anchorId);
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
          element?.classList.add("highlight-flash");
          setTimeout(() => element?.classList.remove("highlight-flash"), 2000);
        }
      }, 300);
    },
    [selectedSectionId, selectSection]
  );

  // CopilotKit Action: Get section content
  useCopilotAction({
    name: "getFilingSection",
    description:
      "Fetch the full text content of a specific section from the current filing. Use this to read detailed information from a particular section.",
    parameters: [
      {
        name: "sectionId",
        type: "string",
        description:
          "The section ID to fetch (e.g., 'item_1a' for Risk Factors, 'item_7' for MD&A)",
        required: true,
      },
    ],
    handler: async ({ sectionId }) => {
      if (!manifest) {
        return { error: "No filing is currently loaded" };
      }

      const filingId = `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}`;
      const response = await fetch(
        `/api/filings/${filingId}/section/${sectionId}?format=text`
      );

      if (!response.ok) {
        return { error: `Section ${sectionId} not found` };
      }

      const data: SectionContent = await response.json();

      // Also update UI to show this section
      setSelectedSectionId(sectionId);
      setSectionContent(data);

      return {
        section: {
          id: data.section.id,
          label: data.section.label,
          text: data.section.text,
          char_count: data.section.char_end - data.section.char_start,
        },
      };
    },
  });

  // CopilotKit Action: Search filing
  useCopilotAction({
    name: "searchFiling",
    description:
      "Search for specific terms or topics within the current filing. Returns matching snippets with section references.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "The search query (keywords or phrases to find)",
        required: true,
      },
      {
        name: "topK",
        type: "number",
        description: "Maximum number of results to return (default: 5)",
        required: false,
      },
    ],
    handler: async ({ query, topK = 5 }) => {
      if (!manifest) {
        return { error: "No filing is currently loaded" };
      }

      const filingId = `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}`;
      const response = await fetch(
        `/api/filings/${filingId}/search?q=${encodeURIComponent(query)}&topK=${topK}`
      );

      if (!response.ok) {
        return { error: "Search failed" };
      }

      const data: SearchResult = await response.json();
      return data;
    },
  });

  // CopilotKit Action: Ask AI about filing
  useCopilotAction({
    name: "askFilingAI",
    description:
      "Ask an analytical question about the filing. Uses RAG to find relevant sections and provide grounded answers with citations.",
    parameters: [
      {
        name: "question",
        type: "string",
        description: "The question to ask about the filing",
        required: true,
      },
      {
        name: "scope",
        type: "string",
        description:
          "Scope of analysis: 'current_section', 'selected_sections', or 'entire_filing' (default)",
        required: false,
      },
    ],
    handler: async ({ question, scope = "entire_filing" }) => {
      if (!manifest) {
        return { error: "No filing is currently loaded" };
      }

      const filingId = `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}`;
      const response = await fetch(`/api/filings/${filingId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope,
          sectionIds: selectedSectionId ? [selectedSectionId] : undefined,
        }),
      });

      if (!response.ok) {
        return { error: "Analysis failed" };
      }

      const data: AskFilingResult = await response.json();
      return data;
    },
  });

  // CopilotKit Action: Navigate to section
  useCopilotAction({
    name: "navigateToSection",
    description:
      "Navigate the UI to display a specific section of the filing. Use this after finding relevant information to show the user.",
    parameters: [
      {
        name: "sectionId",
        type: "string",
        description: "The section ID to navigate to",
        required: true,
      },
    ],
    handler: async ({ sectionId }) => {
      if (!manifest) {
        return { error: "No filing is currently loaded" };
      }

      selectSection(sectionId);
      return { success: true, navigatedTo: sectionId };
    },
  });

  const value: FilingProviderState = {
    manifest,
    selectedSectionId,
    viewMode,
    sectionContent,
    isLoadingSection,
    isChatOpen,
    chatWidth,
    setManifest,
    selectSection,
    setViewMode,
    highlightAnchor,
    setIsChatOpen,
    setChatWidth,
  };

  return (
    <FilingStateContext.Provider value={value}>
      {children}
    </FilingStateContext.Provider>
  );
}

export function useFilingContext() {
  const context = useContext(FilingStateContext);
  if (!context) {
    throw new Error("useFilingContext must be used within a FilingProvider");
  }
  return context;
}
