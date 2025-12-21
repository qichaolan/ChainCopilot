"use client";

/**
 * FilingsList Component
 *
 * Displays a list of SEC filings with:
 * - Company selector
 * - Form type filter (10-K / 10-Q)
 * - Sortable filing list
 */

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Filter,
  Search,
  Calendar,
  Building2,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { FilingsListItem } from "@/lib/sec/types";

interface FilingsListProps {
  initialFilings?: FilingsListItem[];
  initialCompanies?: string[];
}

export function FilingsList({ initialFilings, initialCompanies }: FilingsListProps) {
  const router = useRouter();
  const [filings, setFilings] = useState<FilingsListItem[]>(initialFilings || []);
  const [companies, setCompanies] = useState<string[]>(initialCompanies || []);
  const [isLoading, setIsLoading] = useState(!initialFilings);
  const [selectedCompany, setSelectedCompany] = useState<string>("");
  const [selectedFormType, setSelectedFormType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch filings on mount if not provided
  useEffect(() => {
    if (!initialFilings) {
      fetchFilings();
    }
  }, []);

  const fetchFilings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/filings");
      const data = await response.json();
      setFilings(data.filings || []);
      setCompanies(data.companies || []);
    } catch (error) {
      console.error("Error fetching filings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter filings based on selections
  const filteredFilings = useMemo(() => {
    return filings.filter((filing) => {
      if (selectedCompany && filing.ticker !== selectedCompany) return false;
      if (selectedFormType && filing.formType !== selectedFormType) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          filing.ticker.toLowerCase().includes(query) ||
          filing.companyName.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [filings, selectedCompany, selectedFormType, searchQuery]);

  // Get unique form types
  const formTypes = useMemo(() => {
    return [...new Set(filings.map((f) => f.formType))].sort();
  }, [filings]);

  const handleFilingClick = (filing: FilingsListItem) => {
    router.push(`/fundamental/${filing.filingId}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Company Filter */}
        <div className="relative min-w-[180px]">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Companies</option>
            {companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </div>

        {/* Form Type Filter */}
        <div className="relative min-w-[140px]">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={selectedFormType}
            onChange={(e) => setSelectedFormType(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Forms</option>
            {formTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filing Count */}
      <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
        {filteredFilings.length} filing{filteredFilings.length !== 1 ? "s" : ""}
      </div>

      {/* Filings List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        ) : filteredFilings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <FileText className="h-8 w-8 mb-2" />
            <p>No filings found</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {filteredFilings.map((filing) => (
              <li key={filing.filingId}>
                <button
                  onClick={() => handleFilingClick(filing)}
                  className="w-full px-4 py-3 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                >
                  {/* Form Type Badge */}
                  <div
                    className={`flex-shrink-0 px-2.5 py-1 rounded text-xs font-semibold ${
                      filing.formType.includes("10-K")
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    }`}
                  >
                    {filing.formType}
                  </div>

                  {/* Company Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {filing.ticker}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {filing.companyName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Filed: {filing.filedAt}
                      </span>
                      {filing.reportPeriod && (
                        <span>Period: {filing.reportPeriod}</span>
                      )}
                      <span>{filing.wordCount.toLocaleString()} words</span>
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
