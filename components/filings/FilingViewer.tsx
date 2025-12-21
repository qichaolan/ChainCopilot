"use client";

/**
 * FilingViewer Component
 *
 * Main viewer for SEC filings with:
 * - Left: Table of Contents (TOC) with sticky header
 * - Center: Section content with independent scrolling
 *
 * Note: Chat panel is rendered at the page level for full-height alignment
 *
 * Features:
 * - Collapsible TOC with icon rail
 * - Search within TOC
 * - localStorage persistence for TOC panel state
 */

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useFilingContext } from "./FilingContext";
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquare,
  Loader2,
  Eye,
  FileCode,
  X,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { FilingManifest } from "@/lib/sec/types";

// Default panel widths
const DEFAULT_TOC_WIDTH = 256; // 16rem = w-64
const MIN_PANEL_WIDTH = 200;
const MAX_TOC_WIDTH = 400;

// Detect device type for per-device persistence
function getDeviceType(): "desktop" | "mobile" {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth >= 768 ? "desktop" : "mobile";
}

// localStorage keys for TOC panel state persistence (per device)
function getStorageKeys() {
  const device = getDeviceType();
  return {
    TOC_OPEN: `filing-viewer-toc-open-${device}`,
    TOC_EXPANDED: `filing-viewer-toc-expanded-${device}`,
    TOC_WIDTH: `filing-viewer-toc-width-${device}`,
  };
}

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

// Resize Handle Component
function ResizeHandle({
  onResize,
  onDoubleClick,
  position,
  currentWidth,
}: {
  onResize: (newWidth: number) => void;
  onDoubleClick: () => void;
  position: "left" | "right";
  currentWidth: number;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = position === "left"
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
        onResize(startWidth + delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize, position, currentWidth]
  );

  return (
    <div
      className="w-1 hover:w-1.5 bg-transparent hover:bg-blue-400 cursor-col-resize transition-all flex-shrink-0 group"
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize, double-click to reset"
    >
      <div className="w-full h-full opacity-0 group-hover:opacity-100 bg-blue-400 transition-opacity" />
    </div>
  );
}

interface FilingViewerProps {
  filingId: string;
}

export function FilingViewer({ filingId }: FilingViewerProps) {
  const {
    manifest,
    setManifest,
    selectedSectionId,
    selectSection,
    viewMode,
    setViewMode,
    sectionContent,
    isLoadingSection,
    isChatOpen,
    setIsChatOpen,
  } = useFilingContext();

  // Get storage keys (device-specific)
  const storageKeys = useMemo(() => getStorageKeys(), []);

  const [isLoadingManifest, setIsLoadingManifest] = useState(true);
  const [isTocOpen, setIsTocOpen] = useState(() => getStoredValue(storageKeys.TOC_OPEN, true));
  const [isTocExpanded, setIsTocExpanded] = useState(() => getStoredValue(storageKeys.TOC_EXPANDED, true));
  const [tocWidth, setTocWidth] = useState(() => getStoredValue(storageKeys.TOC_WIDTH, DEFAULT_TOC_WIDTH));
  const [tocSearch, setTocSearch] = useState("");
  const [rawHtml, setRawHtml] = useState<string | null>(null);

  // Persist TOC panel states
  useEffect(() => {
    setStoredValue(storageKeys.TOC_OPEN, isTocOpen);
  }, [isTocOpen, storageKeys.TOC_OPEN]);

  useEffect(() => {
    setStoredValue(storageKeys.TOC_EXPANDED, isTocExpanded);
  }, [isTocExpanded, storageKeys.TOC_EXPANDED]);

  useEffect(() => {
    setStoredValue(storageKeys.TOC_WIDTH, tocWidth);
  }, [tocWidth, storageKeys.TOC_WIDTH]);

  // Resize handlers
  const handleTocResize = useCallback((newWidth: number) => {
    setTocWidth(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_TOC_WIDTH, newWidth)));
  }, []);

  const resetTocWidth = useCallback(() => {
    setTocWidth(DEFAULT_TOC_WIDTH);
  }, []);

  // Filter sections based on search
  const filteredSections = useMemo(() => {
    if (!manifest || !tocSearch.trim()) return manifest?.sections || [];
    const query = tocSearch.toLowerCase();
    return manifest.sections.filter((s) =>
      s.label.toLowerCase().includes(query)
    );
  }, [manifest, tocSearch]);

  // Load manifest on mount
  useEffect(() => {
    loadManifest();
  }, [filingId]);

  const loadManifest = async () => {
    setIsLoadingManifest(true);
    try {
      const response = await fetch(`/api/filings/${filingId}/manifest`);
      if (response.ok) {
        const data: FilingManifest = await response.json();
        setManifest(data);

        // Auto-select first meaningful section
        if (data.sections.length > 0) {
          const firstSection = data.sections.find(
            (s) =>
              s.id === "item_1a" || s.id === "item_7" || s.id === "item_1"
          );
          // Pass filingId explicitly since manifest state may not have updated yet
          selectSection(firstSection?.id || data.sections[0].id, filingId);
        }
      }
    } catch (error) {
      console.error("Error loading manifest:", error);
    } finally {
      setIsLoadingManifest(false);
    }
  };

  // Load raw HTML when switching to as-filed mode
  useEffect(() => {
    if (viewMode === "asFiled" && !rawHtml) {
      loadRawHtml();
    }
  }, [viewMode]);

  const loadRawHtml = async () => {
    try {
      const ticker = filingId.split("-")[0];
      const response = await fetch(`/api/filings/${filingId}/html`);
      if (response.ok) {
        const html = await response.text();
        setRawHtml(html);
      }
    } catch (error) {
      console.error("Error loading raw HTML:", error);
    }
  };

  if (isLoadingManifest) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <FileText className="h-12 w-12 mb-4" />
        <p className="text-lg">Filing not found</p>
        <a
          href="/fundamental"
          className="mt-4 text-blue-500 hover:text-blue-600 flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to filings
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-50 dark:bg-slate-900">
      {/* TOC Sidebar - Collapsed State (Icon Rail) */}
      {!isTocOpen && (
        <aside className="w-12 h-full flex-shrink-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col items-center py-3">
          <button
            onClick={() => setIsTocOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400"
            title="Show Table of Contents"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="mt-4 -rotate-90 whitespace-nowrap text-xs text-gray-400 origin-center">
            <span className="font-semibold">{manifest.ticker}</span>
            <span className="mx-1">•</span>
            <span>{manifest.form_type}</span>
          </div>
        </aside>
      )}

      {/* TOC Sidebar - Expanded State */}
      {isTocOpen && (
        <>
        <aside
          style={{ width: tocWidth }}
          className="h-full flex-shrink-0 min-h-0 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col">
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-800">
            {/* Filing Info + Collapse Button */}
            <div className="p-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      manifest.form_type.includes("10-K")
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    }`}
                  >
                    {manifest.form_type}
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {manifest.ticker}
                  </span>
                </div>
                <button
                  onClick={() => setIsTocOpen(false)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400"
                  title="Collapse TOC"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {manifest.company_name}
              </p>
              <div className="mt-2 text-xs text-gray-400">
                Filed: {manifest.filed_at}
                {manifest.report_period && (
                  <span className="ml-2">• Period: {manifest.report_period}</span>
                )}
              </div>
            </div>

            {/* Search + Expand/Collapse Controls */}
            <div className="p-2 border-b border-gray-200 dark:border-slate-700">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search sections..."
                  value={tocSearch}
                  onChange={(e) => setTocSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-gray-400"
                />
                {tocSearch && (
                  <button
                    onClick={() => setTocSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600"
                  >
                    <X className="h-3 w-3 text-gray-400" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  {filteredSections.length} sections
                </span>
                <button
                  onClick={() => setIsTocExpanded(!isTocExpanded)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {isTocExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Expand
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Sections List - Scrolls Independently */}
          <nav className="flex-1 overflow-y-auto p-2">
            {isTocExpanded ? (
              <ul className="space-y-1">
                {filteredSections.map((section) => (
                  <li key={section.id}>
                    <button
                      onClick={() => selectSection(section.id)}
                      className={`w-full px-3 py-2 text-sm text-left rounded-lg transition-colors ${
                        selectedSectionId === section.id
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      {section.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-400 text-center py-4">
                Click "Expand" to show sections
              </div>
            )}
          </nav>

          {/* Stats Footer */}
          <div className="p-3 border-t border-gray-200 dark:border-slate-700 text-xs text-gray-400">
            {manifest.stats.word_count.toLocaleString()} words •{" "}
            {manifest.stats.section_count} sections
          </div>
        </aside>
        {/* TOC Resize Handle */}
        <ResizeHandle
          position="left"
          currentWidth={tocWidth}
          onResize={handleTocResize}
          onDoubleClick={resetTocWidth}
        />
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            {!isTocOpen && (
              <button
                onClick={() => setIsTocOpen(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                title="Show TOC"
              >
                <List className="h-4 w-4 text-gray-500" />
              </button>
            )}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {manifest.sections.find((s) => s.id === selectedSectionId)?.label ||
                "Select a section"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("clean")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "clean"
                    ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Clean
              </button>
              <button
                onClick={() => setViewMode("asFiled")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "asFiled"
                    ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <FileCode className="h-3.5 w-3.5" />
                As Filed
              </button>
            </div>

            {!isChatOpen && (
              <button
                onClick={() => setIsChatOpen(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500"
                title="Show Chat"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoadingSection ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : viewMode === "clean" && sectionContent ? (
            <article className="sec-section-content prose prose-gray dark:prose-invert max-w-none">
              <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white border-b border-gray-200 dark:border-slate-700 pb-3">
                {sectionContent.section.label}
              </h2>
              {sectionContent.section.html ? (
                <div
                  className="sec-content"
                  dangerouslySetInnerHTML={{ __html: sectionContent.section.html }}
                />
              ) : (
                <div className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 leading-relaxed">
                  {sectionContent.section.text}
                </div>
              )}
            </article>
          ) : viewMode === "asFiled" && rawHtml ? (
            <div
              className="sec-raw-html"
              dangerouslySetInnerHTML={{ __html: rawHtml }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <FileText className="h-8 w-8 mb-2" />
              <p>Select a section from the TOC</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
