import { TrendingUp } from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Logo and Description */}
          <div className="flex flex-col items-center sm:items-start gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                ChainCopilot
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
              AI-powered options analysis with CopilotKit & Gemini
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            <a
              href="https://github.com/qichaolan/ChainCopilot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              GitHub
            </a>
            <a
              href="mailto:info@optchain.app"
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              Contact
            </a>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              &copy; {new Date().getFullYear()} ChainCopilot
            </span>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
          <p className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-500 text-center leading-relaxed">
            Options trading involves substantial risk and is not suitable for all investors.
            This tool is for educational and informational purposes only. Not financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
