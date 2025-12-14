'use client';

/**
 * Options Actions - AG-UI compliant actions for options analysis
 *
 * Uses CopilotKit's useCopilotAction with render functions to display
 * structured data as UI components following the AG-UI protocol.
 */

import { useCopilotAction } from '@copilotkit/react-core';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Target,
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  Info,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface Metric {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
}

interface AnalysisSection {
  heading: string;
  content: string;
}

// ============================================================================
// UI Components
// ============================================================================

function MetricsCard({ title, metrics, summary }: { title: string; metrics: Metric[]; summary?: string }) {
  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
      case 'down': return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
      default: return <Minus className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const getTrendColor = (trend?: string) => {
    switch (trend) {
      case 'up': return 'text-green-600 dark:text-green-400';
      case 'down': return 'text-red-600 dark:text-red-400';
      default: return 'text-gray-900 dark:text-white';
    }
  };

  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      <div className="px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white flex items-center gap-2">
        <BarChart3 className="w-4 h-4" />
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <div className="p-3 bg-white dark:bg-slate-800">
        <div className="grid grid-cols-2 gap-2">
          {metrics.map((metric, idx) => (
            <div key={idx} className="p-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-600">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{metric.label}</span>
                {getTrendIcon(metric.trend)}
              </div>
              <div className={`text-base font-bold ${getTrendColor(metric.trend)}`}>{metric.value}</div>
            </div>
          ))}
        </div>
        {summary && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-600">
            <p className="text-xs text-gray-600 dark:text-gray-400">{summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisCard({ title, sections, recommendation }: { title: string; sections: AnalysisSection[]; recommendation?: string }) {
  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      <div className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center gap-2">
        <Lightbulb className="w-4 h-4" />
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <div className="p-3 bg-white dark:bg-slate-800 space-y-3">
        {sections.map((section, idx) => (
          <div key={idx}>
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5">
              <Info className="w-3 h-3 text-purple-500" />
              {section.heading}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{section.content}</p>
          </div>
        ))}
        {recommendation && (
          <div className="mt-3 p-2.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-purple-800 dark:text-purple-300 font-medium">{recommendation}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StrategyCard({ name, description, risk, reward, bestFor }: {
  name: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  reward: 'limited' | 'moderate' | 'unlimited';
  bestFor: string;
}) {
  const getRiskColor = (r: string) => {
    switch (r) {
      case 'low': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'high': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getRewardColor = (r: string) => {
    switch (r) {
      case 'limited': return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'moderate': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'unlimited': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      <div className="px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white flex items-center gap-2">
        <Target className="w-4 h-4" />
        <span className="font-semibold text-sm">{name}</span>
      </div>
      <div className="p-3 bg-white dark:bg-slate-800">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{description}</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(risk)}`}>
            <AlertTriangle className="w-3 h-3 inline mr-1" />Risk: {risk}
          </span>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRewardColor(reward)}`}>
            <CheckCircle className="w-3 h-3 inline mr-1" />Reward: {reward}
          </span>
        </div>
        <div className="p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
          <span className="text-xs text-gray-500 dark:text-gray-400">Best for: </span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{bestFor}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Hook: Register AG-UI Actions
// ============================================================================

export function useOptionsActions() {
  // Action: Display metrics card
  // NOTE: Using JSON string for metrics array to work around Gemini API schema limitations
  useCopilotAction({
    name: 'displayMetrics',
    description: 'Display key metrics in a visual card format. Use this when showing numerical data like volume, IV, ratios, prices.',
    parameters: [
      { name: 'title', type: 'string', description: 'Title for the metrics card', required: true },
      { name: 'metricsJson', type: 'string', description: 'JSON array string of metrics. Each metric: {"label": "string", "value": "string", "trend": "up"|"down"|"neutral"}. Example: [{"label":"IV","value":"45%","trend":"up"}]', required: true },
      { name: 'summary', type: 'string', description: 'Brief summary text', required: false },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let metrics: Metric[] = [];
        try {
          metrics = JSON.parse(args.metricsJson as string || '[]');
        } catch { /* keep empty array */ }
        return (
          <MetricsCard
            title={args.title || 'Metrics'}
            metrics={metrics}
            summary={args.summary as string}
          />
        );
      }
      return <></>;
    },
    handler: async ({ title, metricsJson, summary }) => {
      let metrics: Metric[] = [];
      try {
        metrics = JSON.parse(metricsJson as string || '[]');
      } catch { /* keep empty array */ }
      return { success: true, title, metricsCount: metrics.length };
    },
  });

  // Action: Display analysis card
  // NOTE: Using JSON string for sections array to work around Gemini API schema limitations
  useCopilotAction({
    name: 'displayAnalysis',
    description: 'Display detailed analysis with multiple sections. Use for in-depth explanations, market analysis, or trade evaluation.',
    parameters: [
      { name: 'title', type: 'string', description: 'Title for the analysis', required: true },
      { name: 'sectionsJson', type: 'string', description: 'JSON array string of sections. Each section: {"heading": "string", "content": "string"}. Example: [{"heading":"Overview","content":"Analysis text here"}]', required: true },
      { name: 'recommendation', type: 'string', description: 'Key takeaway or recommendation', required: false },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let sections: AnalysisSection[] = [];
        try {
          sections = JSON.parse(args.sectionsJson as string || '[]');
        } catch { /* keep empty array */ }
        return (
          <AnalysisCard
            title={args.title || 'Analysis'}
            sections={sections}
            recommendation={args.recommendation as string}
          />
        );
      }
      return <></>;
    },
    handler: async ({ title, sectionsJson, recommendation }) => {
      let sections: AnalysisSection[] = [];
      try {
        sections = JSON.parse(sectionsJson as string || '[]');
      } catch { /* keep empty array */ }
      return { success: true, title, sectionsCount: sections.length };
    },
  });

  // Action: Display strategy card
  useCopilotAction({
    name: 'displayStrategy',
    description: 'Display information about an options trading strategy. Use when explaining strategies like covered calls, spreads, etc.',
    parameters: [
      { name: 'name', type: 'string', description: 'Strategy name', required: true },
      { name: 'description', type: 'string', description: 'What the strategy is', required: true },
      { name: 'risk', type: 'string', description: 'Risk level: low, medium, or high', required: true },
      { name: 'reward', type: 'string', description: 'Reward potential: limited, moderate, or unlimited', required: true },
      { name: 'bestFor', type: 'string', description: 'Market conditions when to use', required: true },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        return (
          <StrategyCard
            name={args.name || 'Strategy'}
            description={args.description || ''}
            risk={(args.risk as 'low' | 'medium' | 'high') || 'medium'}
            reward={(args.reward as 'limited' | 'moderate' | 'unlimited') || 'moderate'}
            bestFor={args.bestFor || ''}
          />
        );
      }
      return <></>;
    },
    handler: async ({ name, description, risk, reward, bestFor }) => {
      return { success: true, strategy: name };
    },
  });
}
