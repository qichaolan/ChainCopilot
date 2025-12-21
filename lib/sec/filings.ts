/**
 * SEC Filings Data Access Layer
 *
 * Provides functions to read filing data from the jobs/sec/data directory.
 * Supports both v1 (flat files) and v2 (display/rag subdirectories) formats.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  FilingManifest,
  FilingSectionIndex,
  FilingChunk,
  FilingsListItem,
  CompanyFilings,
  SectionContent,
  SearchMatch,
  SearchResult,
  FilingSectionDetail,
} from "./types";

// Base path to SEC data directory
const SEC_DATA_DIR = path.join(process.cwd(), "jobs/sec/data");

/**
 * Check if a filing has v2 structure (display/rag subdirectories)
 */
async function hasV2Structure(ticker: string, filingId: string): Promise<boolean> {
  const v2Path = path.join(SEC_DATA_DIR, ticker, filingId, "display", "manifest.json");
  try {
    await fs.access(v2Path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of all companies with filings
 */
export async function getCompanies(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SEC_DATA_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    console.error("Error reading companies:", error);
    return [];
  }
}

/**
 * Get all filings for a specific company
 */
export async function getCompanyFilings(ticker: string): Promise<CompanyFilings | null> {
  const companyDir = path.join(SEC_DATA_DIR, ticker.toUpperCase());

  try {
    const entries = await fs.readdir(companyDir, { withFileTypes: true });
    const filings: FilingsListItem[] = [];
    let companyName = ticker;

    // Look for v2 directories first (e.g., AAPL-10-K-2024-11-01/)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const filingId = entry.name;
      const v2ManifestPath = path.join(companyDir, filingId, "display", "manifest.json");

      try {
        const data = await fs.readFile(v2ManifestPath, "utf-8");
        const manifest = JSON.parse(data);

        companyName = manifest.company_name || ticker;

        filings.push({
          ticker: manifest.ticker,
          filingId: manifest.filing_id,
          formType: manifest.form_type,
          filedAt: manifest.filed_at,
          reportPeriod: manifest.report_period,
          companyName: manifest.company_name,
          wordCount: manifest.stats?.word_count || 0,
        });
      } catch {
        // Skip directories without v2 manifest
      }
    }

    // Fallback to v1 files if no v2 found
    if (filings.length === 0) {
      const files = await fs.readdir(companyDir);
      const manifestFiles = files.filter((f) => f.endsWith("-manifest.json"));

      for (const manifestFile of manifestFiles) {
        const manifestPath = path.join(companyDir, manifestFile);
        const data = await fs.readFile(manifestPath, "utf-8");
        const manifest: FilingManifest = JSON.parse(data);

        companyName = manifest.company_name || ticker;
        const filingId = manifestFile.replace("-manifest.json", "");

        filings.push({
          ticker: manifest.ticker,
          filingId,
          formType: manifest.form_type,
          filedAt: manifest.filed_at,
          reportPeriod: manifest.report_period,
          companyName: manifest.company_name,
          wordCount: manifest.stats.word_count,
        });
      }
    }

    // Sort by filed date descending
    filings.sort((a, b) => b.filedAt.localeCompare(a.filedAt));

    return {
      ticker: ticker.toUpperCase(),
      companyName,
      filings,
    };
  } catch (error) {
    console.error(`Error reading filings for ${ticker}:`, error);
    return null;
  }
}

/**
 * Get all filings across all companies
 */
export async function getAllFilings(
  formTypeFilter?: string
): Promise<FilingsListItem[]> {
  const companies = await getCompanies();
  const allFilings: FilingsListItem[] = [];

  for (const ticker of companies) {
    const companyFilings = await getCompanyFilings(ticker);
    if (companyFilings) {
      allFilings.push(...companyFilings.filings);
    }
  }

  // Filter by form type if specified
  let filtered = allFilings;
  if (formTypeFilter) {
    filtered = allFilings.filter((f) =>
      f.formType.toLowerCase() === formTypeFilter.toLowerCase()
    );
  }

  // Sort by filed date descending
  return filtered.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

/**
 * Get filing manifest by filing ID (e.g., "AAPL-10-K-2024-11-01")
 */
export async function getFilingManifest(filingId: string): Promise<FilingManifest | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];

  // Try v2 path first
  const v2Path = path.join(SEC_DATA_DIR, ticker, filingId, "display", "manifest.json");
  try {
    const data = await fs.readFile(v2Path, "utf-8");
    return JSON.parse(data);
  } catch {
    // Fall back to v1 path
    const v1Path = path.join(SEC_DATA_DIR, ticker, `${filingId}-manifest.json`);
    try {
      const data = await fs.readFile(v1Path, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading manifest for ${filingId}:`, error);
      return null;
    }
  }
}

/**
 * Get section index for a filing
 */
export async function getFilingSectionIndex(filingId: string): Promise<FilingSectionIndex | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];

  // Try v2: Build section index from manifest + rag/sections.jsonl
  const v2ManifestPath = path.join(SEC_DATA_DIR, ticker, filingId, "display", "manifest.json");
  const v2SectionsPath = path.join(SEC_DATA_DIR, ticker, filingId, "rag", "sections.jsonl");

  try {
    const manifestData = await fs.readFile(v2ManifestPath, "utf-8");
    const manifest = JSON.parse(manifestData);

    const sectionsData = await fs.readFile(v2SectionsPath, "utf-8");
    const sections: FilingSectionDetail[] = sectionsData
      .trim()
      .split("\n")
      .map((line: string) => {
        const s = JSON.parse(line);
        return {
          id: s.id,
          label: s.label,
          char_start: s.char_start,
          char_end: s.char_end,
          anchors: [],
          chunk_ids: [],
        };
      });

    return {
      filing_id: manifest.filing_id,
      sections,
    };
  } catch {
    // Fall back to v1 path
    const v1Path = path.join(SEC_DATA_DIR, ticker, `${filingId}-sections.json`);
    try {
      const data = await fs.readFile(v1Path, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading sections for ${filingId}:`, error);
      return null;
    }
  }
}

/**
 * Get raw HTML for a filing
 */
export async function getFilingHtml(filingId: string): Promise<string | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];

  // Try v2 path first
  const v2Path = path.join(SEC_DATA_DIR, ticker, filingId, "display", "raw_primary.html");
  try {
    return await fs.readFile(v2Path, "utf-8");
  } catch {
    // Fall back to v1 path
    const v1Path = path.join(SEC_DATA_DIR, ticker, `${filingId}.html`);
    try {
      return await fs.readFile(v1Path, "utf-8");
    } catch (error) {
      console.error(`Error reading HTML for ${filingId}:`, error);
      return null;
    }
  }
}

/**
 * Get clean text for a filing (concatenated from all sections)
 */
export async function getFilingText(filingId: string): Promise<string | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];

  // Try v2: Build text from rag/sections.jsonl
  const v2Path = path.join(SEC_DATA_DIR, ticker, filingId, "rag", "sections.jsonl");
  try {
    const data = await fs.readFile(v2Path, "utf-8");
    const sections = data
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    return sections.map((s: { text: string }) => s.text).join("\n\n");
  } catch {
    // Fall back to v1 path
    const v1Path = path.join(SEC_DATA_DIR, ticker, `${filingId}.txt`);
    try {
      return await fs.readFile(v1Path, "utf-8");
    } catch (error) {
      console.error(`Error reading text for ${filingId}:`, error);
      return null;
    }
  }
}

/**
 * Get section content by section ID
 * Returns HTML from v2 per-section files when available
 */
export async function getFilingSection(
  filingId: string,
  sectionId: string,
  format: "text" | "html" = "text"
): Promise<SectionContent | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];

  // Try v2: Read from display/sections/{section_id}.html
  const v2HtmlPath = path.join(SEC_DATA_DIR, ticker, filingId, "display", "sections", `${sectionId}.html`);
  const v2SectionsPath = path.join(SEC_DATA_DIR, ticker, filingId, "rag", "sections.jsonl");

  try {
    // Get section metadata from sections.jsonl
    const sectionsData = await fs.readFile(v2SectionsPath, "utf-8");
    const sections = sectionsData
      .trim()
      .split("\n")
      .map((line: string) => JSON.parse(line));

    const section = sections.find((s: { id: string }) => s.id === sectionId);
    if (!section) return null;

    // Read HTML content
    let sectionHtml: string;
    try {
      const rawHtml = await fs.readFile(v2HtmlPath, "utf-8");
      const trimmedHtml = rawHtml.trim();

      // Check if HTML is substantially smaller than text (likely incomplete/ToC only)
      // Use text-based rendering if HTML is less than 50% of text size
      // (HTML with proper formatting should be larger than plain text, not smaller)
      const textLength = section.text?.length || 0;
      const htmlLength = trimmedHtml.length;
      const isHtmlIncomplete = textLength > 1000 && htmlLength < textLength * 0.5;

      // Also check for part_* Financial sections which are typically ToC-only
      // and need full content extracted from raw_primary.html
      const isFinancialTocSection = sectionId.startsWith('part_') &&
        section.label?.toLowerCase().includes('financial') &&
        htmlLength < 50000; // ToC sections are typically small

      if (isHtmlIncomplete || isFinancialTocSection) {
        // HTML file is likely just a ToC or fragment - extract from raw_primary.html
        const rawPrimaryPath = path.join(SEC_DATA_DIR, ticker, filingId, "display", "raw_primary.html");
        sectionHtml = await extractSectionFromRawHtml(rawPrimaryPath, section, sections);
      } else {
        // Wrap orphaned table elements (td, tr) in a proper table structure
        if (trimmedHtml.startsWith("<td") || trimmedHtml.startsWith("<tr")) {
          sectionHtml = `<table class="sec-table"><tbody>${trimmedHtml.startsWith("<td") ? "<tr>" + rawHtml + "</tr>" : rawHtml}</tbody></table>`;
        } else {
          sectionHtml = rawHtml;
        }
      }
    } catch {
      // Fall back to escaped text if no HTML file
      sectionHtml = `<div class="section-content">${escapeHtml(section.text)}</div>`;
    }

    return {
      filing_id: filingId,
      section: {
        id: section.id,
        label: section.label,
        text: section.text,
        html: format === "html" ? sectionHtml : undefined,
        anchors: [],
        char_start: section.char_start,
        char_end: section.char_end,
      },
    };
  } catch {
    // Fall back to v1 behavior
    const sectionIndex = await getFilingSectionIndex(filingId);
    if (!sectionIndex) return null;

    const section = sectionIndex.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    const fullText = await getFilingText(filingId);
    if (!fullText) return null;

    let sectionText = fullText.slice(section.char_start, section.char_end);
    if (sectionText.length > 100000) {
      sectionText = sectionText.slice(0, 100000);
    }

    return {
      filing_id: sectionIndex.filing_id,
      section: {
        id: section.id,
        label: section.label,
        text: sectionText,
        html: format === "html" ? `<div class="section-content">${escapeHtml(sectionText)}</div>` : undefined,
        anchors: section.anchors,
        char_start: section.char_start,
        char_end: section.char_end,
      },
    };
  }
}

/**
 * Get all chunks for a filing
 */
export async function getFilingChunks(filingId: string): Promise<FilingChunk[]> {
  const parts = filingId.split("-");
  if (parts.length < 4) return [];

  const ticker = parts[0];

  // Try v2 path first
  const v2Path = path.join(SEC_DATA_DIR, ticker, filingId, "rag", "chunks.jsonl");
  try {
    const data = await fs.readFile(v2Path, "utf-8");
    const lines = data.trim().split("\n");
    return lines.map((line) => {
      const chunk = JSON.parse(line);
      // v2 chunks don't have char_start/char_end, but have anchor_id
      return {
        id: chunk.id,
        section_id: chunk.section_id,
        text: chunk.text,
        char_start: 0, // Not available in v2
        char_end: 0,   // Not available in v2
        token_count: chunk.token_count,
        anchor_id: chunk.anchor_id,
        block_index: chunk.block_index,
      };
    });
  } catch {
    // Fall back to v1 path
    const v1Path = path.join(SEC_DATA_DIR, ticker, `${filingId}-chunks.jsonl`);
    try {
      const data = await fs.readFile(v1Path, "utf-8");
      const lines = data.trim().split("\n");
      return lines.map((line) => JSON.parse(line));
    } catch (error) {
      console.error(`Error reading chunks for ${filingId}:`, error);
      return [];
    }
  }
}

/**
 * Get anchors for a filing (v2 only)
 */
export async function getFilingAnchors(filingId: string): Promise<Record<string, unknown> | null> {
  const parts = filingId.split("-");
  if (parts.length < 4) return null;

  const ticker = parts[0];
  const anchorsPath = path.join(SEC_DATA_DIR, ticker, filingId, "display", "anchors.json");

  try {
    const data = await fs.readFile(anchorsPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Get chunks for a specific section
 */
export async function getSectionChunks(
  filingId: string,
  sectionId: string
): Promise<FilingChunk[]> {
  const chunks = await getFilingChunks(filingId);
  return chunks.filter((c) => c.section_id === sectionId);
}

/**
 * Simple text search within a filing
 * Returns matching chunks with scores based on keyword density
 */
export async function searchFiling(
  filingId: string,
  query: string,
  topK: number = 5
): Promise<SearchResult> {
  const chunks = await getFilingChunks(filingId);

  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const matches: SearchMatch[] = [];

  for (const chunk of chunks) {
    const textLower = chunk.text.toLowerCase();
    let matchCount = 0;

    for (const term of queryTerms) {
      const regex = new RegExp(term, "gi");
      const termMatches = textLower.match(regex);
      if (termMatches) {
        matchCount += termMatches.length;
      }
    }

    if (matchCount > 0) {
      // Calculate score based on term density
      const score = matchCount / (chunk.token_count / 100);

      // Get snippet around first match
      const firstTermIndex = queryTerms.reduce((minIdx, term) => {
        const idx = textLower.indexOf(term);
        return idx !== -1 && (minIdx === -1 || idx < minIdx) ? idx : minIdx;
      }, -1);

      const snippetStart = Math.max(0, firstTermIndex - 50);
      const snippetEnd = Math.min(chunk.text.length, firstTermIndex + 200);
      const snippet = chunk.text.slice(snippetStart, snippetEnd);

      matches.push({
        section_id: chunk.section_id,
        chunk_id: chunk.id,
        snippet: (snippetStart > 0 ? "..." : "") + snippet + (snippetEnd < chunk.text.length ? "..." : ""),
        score: Math.min(1, score / 10), // Normalize to 0-1
        char_start: chunk.char_start,
        char_end: chunk.char_end,
      });
    }
  }

  // Sort by score descending and take top K
  matches.sort((a, b) => b.score - a.score);

  return {
    filing_id: filingId,
    query,
    matches: matches.slice(0, topK),
  };
}

/**
 * Get context for RAG - retrieves relevant chunks for a question
 */
export async function getRAGContext(
  filingId: string,
  question: string,
  scope: "current_section" | "selected_sections" | "entire_filing" = "entire_filing",
  sectionIds?: string[]
): Promise<{ chunks: FilingChunk[]; sections: FilingSectionDetail[] }> {
  let chunks = await getFilingChunks(filingId);
  const sectionIndex = await getFilingSectionIndex(filingId);

  // Filter chunks by scope
  if (scope === "selected_sections" && sectionIds) {
    chunks = chunks.filter((c) => sectionIds.includes(c.section_id));
  } else if (scope === "current_section" && sectionIds?.[0]) {
    chunks = chunks.filter((c) => c.section_id === sectionIds[0]);
  }

  // Simple keyword matching for now
  // TODO: Implement proper vector search with embeddings
  const queryTerms = question.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const scoredChunks = chunks.map((chunk) => {
    const textLower = chunk.text.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      if (textLower.includes(term)) {
        score += 1;
      }
    }

    return { chunk, score };
  });

  // Sort by score and take top chunks
  scoredChunks.sort((a, b) => b.score - a.score);
  const topChunks = scoredChunks.slice(0, 10).map((sc) => sc.chunk);

  // Get unique sections for these chunks
  const sectionIdsInContext = [...new Set(topChunks.map((c) => c.section_id))];
  const sections = sectionIndex?.sections.filter((s) =>
    sectionIdsInContext.includes(s.id)
  ) || [];

  return { chunks: topChunks, sections };
}

// Helper function to extract section HTML from raw_primary.html
async function extractSectionFromRawHtml(
  rawPrimaryPath: string,
  section: { id: string; label: string; text: string; char_start?: number; char_end?: number },
  allSections: Array<{ id: string; label: string; char_start?: number; char_end?: number }>
): Promise<string> {
  try {
    const rawHtml = await fs.readFile(rawPrimaryPath, "utf-8");

    let startPos = -1;

    // Strategy 1: Find by ID anchor (most reliable for standard filings)
    // Look for id="item_1..." or id="part_1..." pattern in the HTML
    const sectionIdBase = section.id.replace(/_/g, '_');
    const idPattern = new RegExp(`id=["']${sectionIdBase}[^"']*["']`, 'i');
    const idMatch = rawHtml.match(idPattern);

    if (idMatch && idMatch.index !== undefined) {
      // Walk back to find the opening tag
      let pos = idMatch.index;
      while (pos > 0 && rawHtml[pos] !== '<') {
        pos--;
      }
      startPos = pos;
    }

    // Strategy 2: For part_1 (Financial Information), find the actual financial statements
    // by looking for the first anchor target from the ToC (usually Balance Sheets)
    if (startPos === -1 && section.id.startsWith('part_') && section.label.toLowerCase().includes('financial')) {
      // Look for "Condensed Consolidated Balance" or similar financial statement headers
      const financialPatterns = [
        /id=["'][^"']*["'][^>]*>[\s\S]*?Condensed\s+Consolidated\s+Balance/i,
        /id=["'][^"']*["'][^>]*>[\s\S]*?CONDENSED\s+CONSOLIDATED\s+BALANCE/i,
        /Condensed\s+Consolidated\s+Balance\s+Sheet/i,
      ];

      for (const pattern of financialPatterns) {
        const match = rawHtml.match(pattern);
        if (match && match.index !== undefined) {
          // Walk back to find a good starting point (look for a main-content-container or table)
          let pos = match.index;
          const searchBack = rawHtml.slice(Math.max(0, pos - 2000), pos);
          const containerMatch = searchBack.match(/.*(<div[^>]*main-content-container|<table)/i);
          if (containerMatch && containerMatch.index !== undefined) {
            startPos = Math.max(0, pos - 2000) + containerMatch.index;
          } else {
            startPos = pos;
          }
          break;
        }
      }
    }

    // Strategy 3: Find in main-content-container with proper Item header
    if (startPos === -1 && section.id.startsWith('item_')) {
      // Look for Item X inside main-content-container (actual content, not ToC)
      const itemNum = section.id.replace('item_', '').replace('_', '');
      const contentPattern = new RegExp(
        `<div[^>]*main-content-container[^>]*>[\\s\\S]*?Item\\s+${itemNum}[A-C]?\\.?\\s*[\\t\\s]*[^<]*<`,
        'i'
      );
      const contentMatch = rawHtml.match(contentPattern);
      if (contentMatch && contentMatch.index !== undefined) {
        startPos = contentMatch.index;
      }
    }

    if (startPos === -1) {
      // Fallback to text
      return `<div class="section-content">${escapeHtml(section.text)}</div>`;
    }

    // Find the next section's start to determine end boundary
    // Sort sections by char_start to find the next one
    const sortedSections = [...allSections]
      .filter(s => s.char_start !== undefined)
      .sort((a, b) => (a.char_start || 0) - (b.char_start || 0));

    const currentIdx = sortedSections.findIndex(s => s.id === section.id);
    const nextSection = currentIdx >= 0 && currentIdx < sortedSections.length - 1
      ? sortedSections[currentIdx + 1]
      : null;

    let endPos = rawHtml.length;

    if (nextSection) {
      // Try to find the next section by its ID anchor first
      const nextIdBase = nextSection.id.replace(/_/g, '_');
      const nextIdPattern = new RegExp(`id=["']${nextIdBase}[^"']*["']`, 'i');
      const searchFrom = startPos + 1000; // Skip past current section header
      const nextIdMatch = rawHtml.slice(searchFrom).match(nextIdPattern);

      if (nextIdMatch && nextIdMatch.index !== undefined) {
        // Walk back to find the opening tag
        let pos = searchFrom + nextIdMatch.index;
        while (pos > searchFrom && rawHtml[pos] !== '<') {
          pos--;
        }
        endPos = pos;
      } else {
        // Fallback to Item header pattern
        const nextPatterns = [
          new RegExp(`<div[^>]*main-content-container[^>]*>[\\s\\S]*?Item\\s+${nextSection.id.replace('item_', '').replace('_', '')}[A-C]?\\.?`, 'i'),
          new RegExp(`>\\s*(PART\\s+[IVX]+)`, 'i'),
        ];

        for (const pattern of nextPatterns) {
          const match = rawHtml.slice(searchFrom).match(pattern);
          if (match && match.index !== undefined) {
            endPos = searchFrom + match.index;
            break;
          }
        }
      }
    }

    // Extract the section HTML
    let sectionHtml = rawHtml.slice(startPos, endPos);

    // Clean up: remove page breaks, headers/footers
    sectionHtml = sectionHtml
      .replace(/<hr[^>]*page-break[^>]*>/gi, '')
      .replace(/Table of Contents/gi, '');

    // Check if extracted content is mostly XBRL metadata (not actual styled content)
    // XBRL-only filings have <ix:nonNumeric> and <xbrli:context> instead of styled HTML
    const isXbrlOnly = sectionHtml.includes('<ix:') || sectionHtml.includes('<xbrli:');
    const hasStyledContent = /<(table|div|p|span)[^>]*style=/i.test(sectionHtml);

    if (isXbrlOnly && !hasStyledContent) {
      // XBRL-only content - fall back to text rendering
      return `<div class="section-content">${escapeHtml(section.text)}</div>`;
    }

    return sectionHtml;
  } catch {
    // Fallback to escaped text
    return `<div class="section-content">${escapeHtml(section.text)}</div>`;
  }
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}
