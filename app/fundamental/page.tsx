import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { FileText } from "lucide-react";

export default function FundamentalPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-6">
            <FileText className="h-8 w-8 text-blue-500" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3">
            AI 10-K Analyzer
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 mb-6">
            Feature coming soon
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto mb-4">
            Upload or search for SEC 10-K filings. AI reads and summarizes the key insights for you.
          </p>
          <ul className="text-sm text-gray-400 dark:text-gray-500 text-left max-w-sm mx-auto space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">•</span>
              <span>Ask: &quot;What are AAPL&apos;s main risk factors?&quot;</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">•</span>
              <span>Get revenue breakdown, segment analysis, guidance</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">•</span>
              <span>Compare YoY changes in key metrics and outlook</span>
            </li>
          </ul>
          <a
            href="/"
            className="inline-block mt-8 px-6 py-2 text-sm font-medium text-blue-500 hover:text-blue-600 border border-blue-500 hover:border-blue-600 rounded-lg transition-colors"
          >
            Back to Options Chain
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
