"use client";

import { useState } from "react";
import { Menu, X, TrendingUp } from "lucide-react";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 sm:h-16 items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <TrendingUp className="h-6 w-6 sm:h-8 sm:w-8 text-blue-500" />
            <span className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              ChainCopilot
            </span>
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <a
              href="/strategies"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Strategies
            </a>
            <a
              href="/screener"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Screener
            </a>
            <a
              href="/fundamental"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Fundamental
            </a>
            <a
              href="https://github.com/qichaolan/ChainCopilot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-500 hover:text-blue-600 transition-colors"
            >
              GitHub
            </a>
          </nav>

          {/* Mobile menu button */}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
          >
            <span className="sr-only">Open main menu</span>
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-200 dark:border-slate-700">
            <nav className="flex flex-col gap-3">
              <a
                href="/strategies"
                className="px-3 py-2 text-base font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                Strategies
              </a>
              <a
                href="/screener"
                className="px-3 py-2 text-base font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                Screener
              </a>
              <a
                href="/fundamental"
                className="px-3 py-2 text-base font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                Fundamental
              </a>
              <a
                href="https://github.com/qichaolan/ChainCopilot"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-base font-medium text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                GitHub
              </a>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
