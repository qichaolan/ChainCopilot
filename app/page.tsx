"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { OptionsChainDashboard } from "@/components/dashboard/OptionsChainDashboard";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import ChatOrchestrator from "@/components/chat/ChatOrchestrator";
import { PanelRight } from "lucide-react";

// Desktop breakpoint (lg in Tailwind)
const DESKTOP_BREAKPOINT = 1024;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check initial value
    const checkDesktop = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    checkDesktop();

    // Listen for resize
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener("change", handler);

    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

function HomeContent() {
  const searchParams = useSearchParams();
  const openCopilotParam = searchParams.get("openCopilot") === "true";
  const isDesktop = useIsDesktop();

  // Chat state - default open on desktop, closed on mobile
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Set initial chat state based on viewport and URL param
  useEffect(() => {
    if (openCopilotParam) {
      setIsChatOpen(true);
    } else {
      // Default: open on desktop, closed on mobile
      setIsChatOpen(isDesktop);
    }
  }, [isDesktop, openCopilotParam]);

  const handleChatOpenChange = useCallback((open: boolean) => {
    setIsChatOpen(open);
  }, []);

  // Desktop layout: Everything reflows when chat is open
  if (isDesktop) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
        {/* Content area - shrinks when chat is open */}
        <div
          className={`transition-[margin] duration-200 ${
            isChatOpen ? 'mr-[380px]' : ''
          }`}
        >
          <Header />

          <main className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
            <div className="max-w-7xl mx-auto">
              <OptionsChainDashboard />
            </div>
            <Footer />
          </main>
        </div>

        {/* Fixed chat panel - full height from top */}
        <ChatOrchestrator
          isOpen={isChatOpen}
          onOpenChange={handleChatOpenChange}
          mode="docked"
        />

        {/* Desktop toggle button when chat is closed */}
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="fixed bottom-6 right-6 w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50 hover:scale-105"
            aria-label="Open chat"
          >
            <PanelRight className="w-6 h-6" />
          </button>
        )}
      </div>
    );
  }

  // Mobile/tablet layout: standard vertical layout with overlay chat
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Header />

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="max-w-7xl mx-auto">
          <OptionsChainDashboard />
        </div>
      </main>

      <Footer />

      {/* Mobile/tablet: overlay chat */}
      <ChatOrchestrator
        isOpen={isChatOpen}
        onOpenChange={handleChatOpenChange}
        mode="overlay"
      />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HomeContent />
    </Suspense>
  );
}
