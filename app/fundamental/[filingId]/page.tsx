"use client";

/**
 * Filing Viewer Page
 *
 * Displays a single SEC filing with:
 * - Table of Contents
 * - Section content (clean or as-filed)
 * - AI Copilot chat for Q&A (full screen height on right)
 */

import { useParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { FilingProvider, useFilingContext } from "@/components/filings/FilingContext";
import { FilingViewer } from "@/components/filings/FilingViewer";
import { FilingChatPanel } from "@/components/filings/FilingChatPanel";
import { Bot } from "lucide-react";

// Inner component that uses FilingContext
function FilingPageContent({ filingId }: { filingId: string }) {
  const { manifest, isChatOpen, chatWidth, setIsChatOpen, setChatWidth } = useFilingContext();

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-slate-900 overflow-hidden">
      {/* Left side: Header + Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 min-h-0 overflow-hidden">
          <FilingViewer filingId={filingId} />
        </main>
      </div>

      {/* Chat Panel - Collapsed State (Icon Rail) - Full screen height */}
      {!isChatOpen && (
        <aside className="w-12 flex-shrink-0 border-l border-gray-200 dark:border-slate-700 bg-gradient-to-b from-blue-500 to-blue-600 flex flex-col items-center py-3">
          <button
            onClick={() => setIsChatOpen(true)}
            className="p-2 rounded-lg hover:bg-white/20 text-white transition-colors"
            title="Show Chat"
          >
            <Bot className="h-5 w-5" />
          </button>
          <div className="mt-4 rotate-90 whitespace-nowrap text-xs text-white/80 origin-center font-medium">
            AI Chat
          </div>
        </aside>
      )}

      {/* Chat Panel - Expanded State - Full screen height */}
      {isChatOpen && (
        <aside
          style={{ width: chatWidth }}
          className="flex-shrink-0 border-l border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col"
        >
          <FilingChatPanel
            welcomeMessage={
              manifest
                ? `I'm ready to help you analyze this ${manifest.form_type} filing for ${manifest.ticker}. You can ask me about:\n\n• Risk factors and key risks\n• Revenue and financial performance\n• Management's discussion (MD&A)\n• Any specific section content\n\nWhat would you like to know?`
                : "I'm ready to help you analyze SEC filings. Select a filing to get started."
            }
            placeholder="Ask about the filing..."
            onClose={() => setIsChatOpen(false)}
          />
        </aside>
      )}
    </div>
  );
}

export default function FilingViewerPage() {
  const params = useParams<{ filingId: string }>();
  const filingId = params.filingId;

  if (!filingId) {
    return null;
  }

  return (
    <FilingProvider>
      <FilingPageContent filingId={filingId} />
    </FilingProvider>
  );
}
