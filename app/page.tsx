"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useCopilotReadable } from "@copilotkit/react-core";
import { OptionsChainDashboard } from "@/components/OptionsChainDashboard";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

function HomeContent() {
  const searchParams = useSearchParams();
  const openCopilot = searchParams.get("openCopilot") === "true";

  // Make current time available to the AI
  useCopilotReadable({
    description: "Current date and time for context",
    value: new Date().toISOString(),
  });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Header />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <OptionsChainDashboard />
      </main>

      <Footer />

      <CopilotSidebar
        defaultOpen={openCopilot}
        labels={{
          title: "ChainCopilot",
          initial: "Hi! I'm your AI options trading assistant. Ask me about options strategies, market analysis, or specific trades.",
          placeholder: "Ask about options, strategies, Greeks...",
        }}
        instructions={`You are ChainCopilot, an expert AI assistant for stock options trading analysis.
You help traders understand:
- Options chain data and Greeks (Delta, Gamma, Theta, Vega, IV)
- Trading strategies (covered calls, cash-secured puts, spreads, iron condors, straddles)
- Risk/reward analysis and probability of profit
- Market sentiment and unusual options activity
- Entry/exit timing and position sizing

Be concise, data-driven, and always emphasize risk management.
When analyzing trades, consider the current market context and the user's likely risk tolerance.
Format numbers clearly and use bullet points for key metrics.`}
        className="z-50"
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
