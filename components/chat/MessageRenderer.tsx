'use client';

/**
 * MessageRenderer - Renders chat messages with structured JSON support
 *
 * Features:
 * - Detects JSON blocks and renders as UI cards
 * - Supports metrics, analysis, and strategy card types
 * - Falls back to markdown for plain text
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Lightbulb,
  Target,
  AlertTriangle,
  CheckCircle,
  Info,
} from 'lucide-react';

interface MessageRendererProps {
  content: string;
  role: 'user' | 'assistant';
}

// ============================================================================
// JSON Response Types
// ============================================================================

interface MetricsResponse {
  type: 'metrics';
  title: string;
  data: { label: string; value: string; trend?: 'up' | 'down' | 'neutral' }[];
  summary?: string;
}

interface AnalysisResponse {
  type: 'analysis';
  title: string;
  sections: { heading: string; content: string }[];
  recommendation?: string;
}

interface StrategyResponse {
  type: 'strategy';
  name: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  reward: 'limited' | 'moderate' | 'unlimited';
  bestFor: string;
}

type StructuredResponse = MetricsResponse | AnalysisResponse | StrategyResponse;

// ============================================================================
// JSON Parsing
// ============================================================================

function extractJSON(content: string): { json: StructuredResponse | null; text: string } {
  // Try to find JSON block in code fence
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.type && ['metrics', 'analysis', 'strategy'].includes(parsed.type)) {
        const textBefore = content.slice(0, jsonMatch.index).trim();
        const textAfter = content.slice(jsonMatch.index! + jsonMatch[0].length).trim();
        return { json: parsed, text: [textBefore, textAfter].filter(Boolean).join('\n\n') };
      }
    } catch (e) {
      // Not valid JSON, fall through
    }
  }

  // Try to find raw JSON object
  const rawJsonMatch = content.match(/\{[\s\S]*"type"\s*:\s*"(metrics|analysis|strategy)"[\s\S]*\}/);
  if (rawJsonMatch) {
    try {
      const parsed = JSON.parse(rawJsonMatch[0]);
      const textBefore = content.slice(0, rawJsonMatch.index).trim();
      const textAfter = content.slice(rawJsonMatch.index! + rawJsonMatch[0].length).trim();
      return { json: parsed, text: [textBefore, textAfter].filter(Boolean).join('\n\n') };
    } catch (e) {
      // Not valid JSON
    }
  }

  return { json: null, text: content };
}

// ============================================================================
// Card Components
// ============================================================================

function MetricsCard({ data }: { data: MetricsResponse }) {
  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
      default:
        return <Minus className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const getTrendColor = (trend?: string) => {
    switch (trend) {
      case 'up':
        return 'text-green-600 dark:text-green-400';
      case 'down':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-900 dark:text-white';
    }
  };

  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white flex items-center gap-2">
        <BarChart3 className="w-4 h-4" />
        <span className="font-semibold text-sm">{data.title}</span>
      </div>

      {/* Metrics Grid */}
      <div className="p-3 bg-white dark:bg-slate-800">
        <div className="grid grid-cols-2 gap-2">
          {data.data.map((metric, idx) => (
            <div
              key={idx}
              className="p-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-600"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {metric.label}
                </span>
                {getTrendIcon(metric.trend)}
              </div>
              <div className={`text-base font-bold ${getTrendColor(metric.trend)}`}>
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        {data.summary && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-600">
            <p className="text-xs text-gray-600 dark:text-gray-400">{data.summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisCard({ data }: { data: AnalysisResponse }) {
  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center gap-2">
        <Lightbulb className="w-4 h-4" />
        <span className="font-semibold text-sm">{data.title}</span>
      </div>

      {/* Sections */}
      <div className="p-3 bg-white dark:bg-slate-800 space-y-3">
        {data.sections.map((section, idx) => (
          <div key={idx}>
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
              <Info className="w-3 h-3 text-purple-500" />
              {section.heading}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {section.content}
            </p>
          </div>
        ))}

        {/* Recommendation */}
        {data.recommendation && (
          <div className="mt-3 p-2.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-purple-800 dark:text-purple-300 font-medium">
                {data.recommendation}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StrategyCard({ data }: { data: StrategyResponse }) {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'high':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getRewardColor = (reward: string) => {
    switch (reward) {
      case 'limited':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'moderate':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'unlimited':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white flex items-center gap-2">
        <Target className="w-4 h-4" />
        <span className="font-semibold text-sm">{data.name}</span>
      </div>

      {/* Content */}
      <div className="p-3 bg-white dark:bg-slate-800">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{data.description}</p>

        {/* Risk/Reward badges */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(data.risk)}`}>
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Risk: {data.risk}
          </span>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRewardColor(data.reward)}`}>
            <CheckCircle className="w-3 h-3 inline mr-1" />
            Reward: {data.reward}
          </span>
        </div>

        {/* Best For */}
        <div className="p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
          <span className="text-xs text-gray-500 dark:text-gray-400">Best for: </span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{data.bestFor}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Markdown Components
// ============================================================================

const markdownComponents = {
  p: ({ children }: any) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }: any) => (
    <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>
  ),
  em: ({ children }: any) => <em className="italic">{children}</em>,
  ul: ({ children }: any) => <ul className="mb-2 ml-1 space-y-1">{children}</ul>,
  li: ({ children }: any) => (
    <li className="flex items-start gap-2">
      <span className="text-blue-500 mt-1">•</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  code: ({ inline, children }: any) =>
    inline ? (
      <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-xs font-mono text-blue-600 dark:text-blue-400">
        {children}
      </code>
    ) : (
      <pre className="my-2 p-2 bg-gray-900 rounded-lg overflow-x-auto">
        <code className="text-xs font-mono text-green-400">{children}</code>
      </pre>
    ),
};

// ============================================================================
// Main Component
// ============================================================================

export function MessageRenderer({ content, role }: MessageRendererProps) {
  if (!content) return null;

  // For user messages, just render plain text
  if (role === 'user') {
    return <span>{content}</span>;
  }

  // For assistant messages, try to extract and render JSON
  const { json, text } = extractJSON(content);

  return (
    <div className="message-content">
      {/* Render any text before/after JSON */}
      {text && (
        <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
      )}

      {/* Render structured JSON as cards */}
      {json && json.type === 'metrics' && <MetricsCard data={json as MetricsResponse} />}
      {json && json.type === 'analysis' && <AnalysisCard data={json as AnalysisResponse} />}
      {json && json.type === 'strategy' && <StrategyCard data={json as StrategyResponse} />}
    </div>
  );
}

export default MessageRenderer;
