/**
 * SEC Filings Types for "Talk to your 10-K" feature.
 */

export interface FilingSection {
  id: string;
  label: string;
}

export interface FilingSectionDetail extends FilingSection {
  char_start: number;
  char_end: number;
  anchors: string[];
  chunk_ids: string[];
}

export interface FilingStats {
  word_count: number;
  section_count: number;
  chunk_count: number;
}

export interface FilingManifest {
  filing_id: string;
  cik: string;
  ticker: string;
  company_name: string;
  form_type: string;
  filed_at: string;
  report_period: string | null;
  sections: FilingSection[];
  stats: FilingStats;
}

export interface FilingSectionIndex {
  filing_id: string;
  sections: FilingSectionDetail[];
}

export interface FilingChunk {
  id: string;
  section_id: string;
  text: string;
  char_start: number;  // Approximate - may drift due to whitespace normalization
  char_end: number;    // Approximate - may drift due to whitespace normalization
  token_count: number;
  anchor_id: string;   // Stable anchor: section_id + block index (e.g., "item_1a_b003")
  block_index: number; // Block index within section for reliable UI highlighting
}

export interface FilingMetadata {
  accessionNumber: string;
  cik: string;
  companyName: string;
  formType: string;
  filedAt: string;
  periodOfReport?: string;
}

// API Response Types
export interface FilingsListItem {
  ticker: string;
  filingId: string;  // e.g., "AAPL-10-K-2024-11-01"
  formType: string;
  filedAt: string;
  reportPeriod: string | null;
  companyName: string;
  wordCount: number;
}

export interface CompanyFilings {
  ticker: string;
  companyName: string;
  filings: FilingsListItem[];
}

export interface SectionContent {
  filing_id: string;
  section: {
    id: string;
    label: string;
    text: string;
    html?: string;
    anchors: string[];
    char_start: number;
    char_end: number;
  };
}

export interface SearchMatch {
  section_id: string;
  chunk_id: string;
  snippet: string;
  score: number;
  char_start: number;
  char_end: number;
}

export interface SearchResult {
  filing_id: string;
  query: string;
  matches: SearchMatch[];
}

export interface AskFilingCitation {
  section_id: string;
  section_label: string;
  chunk_id: string;
  snippet: string;
}

export interface AskFilingResult {
  filing_id: string;
  question: string;
  answer: string;
  citations: AskFilingCitation[];
  confidence: number;
  followups: string[];
}

// UI State types for CopilotKit readable context
export interface FilingUIState {
  selectedSectionId: string | null;
  viewMode: "clean" | "asFiled";
  highlightedText: string | null;
  searchQuery: string | null;
}

export interface FilingContext {
  activeCompany: {
    ticker: string;
    cik: string;
    name: string;
  } | null;
  activeFiling: {
    filingId: string;
    formType: string;
    filedAt: string;
    reportPeriod: string | null;
  } | null;
  toc: FilingSection[];
  uiState: FilingUIState;
}
