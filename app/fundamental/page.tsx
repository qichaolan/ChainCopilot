"use client";

/**
 * Fundamental Analysis Page - SEC Filings List
 *
 * Browse and search SEC 10-K and 10-Q filings for AI-powered analysis.
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { FilingsList } from "@/components/filings/FilingsList";
import { FileText, TrendingUp } from "lucide-react";

export default function FundamentalPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col">
        {/* Page Header */}
        <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Fundamental Analysis
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  AI-powered SEC 10-K and 10-Q filing analysis
                </p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="mt-4 flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                <span>Talk to your 10-K with AI</span>
              </div>
              <span>•</span>
              <span>Grounded answers with citations</span>
              <span>•</span>
              <span>Risk factors, MD&A, financials</span>
            </div>
          </div>
        </div>

        {/* Filings List */}
        <div className="flex-1 max-w-7xl mx-auto w-full">
          <div className="bg-white dark:bg-slate-800 shadow-sm rounded-lg m-4 sm:m-6 lg:m-8 overflow-hidden h-[calc(100vh-280px)]">
            <FilingsList />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
