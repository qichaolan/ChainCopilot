'use client';

/**
 * ChatOrchestrator - Manages message state with guaranteed ordering
 *
 * Supports two modes:
 * - Desktop (≥1024px): Persistent docked side panel that causes main content to reflow
 * - Mobile (<1024px): Overlay bottom sheet
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  useCopilotReadable,
  useCopilotAdditionalInstructions,
  useCopilotChatSuggestions,
  useLazyToolRenderer,
} from '@copilotkit/react-core';
// @ts-ignore - Internal API for custom chat implementation
import { useCopilotChatInternal } from '@copilotkit/react-core';
import { Send, X, Loader2, MessageSquare, Bot, User, PanelRightClose } from 'lucide-react';
import { COPILOT_INSTRUCTIONS, CHAT_WELCOME_MESSAGE } from '@/lib/ai/prompts';
import { MessageRenderer } from './MessageRenderer';
import { useOptionsActions } from './actions/useOptionsActions';
import { useOptionsChain } from '@/components/dashboard/options-chain/context/OptionsChainContext';

// ============================================================================
// Types
// ============================================================================

interface OrchestratedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'streaming' | 'complete';
  timestamp: number;
  // Store raw CopilotKit message for action rendering
  rawMessage?: any;
}

interface ChatOrchestratorProps {
  /** Whether the chat panel is open */
  isOpen: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Render mode: 'docked' for desktop, 'overlay' for mobile */
  mode: 'docked' | 'overlay';
}

// ============================================================================
// Message Orchestrator Hook (single writer)
// ============================================================================

function useMessageOrchestrator() {
  const [messages, setMessages] = useState<OrchestratedMessage[]>([]);

  const appendUserMessage = useCallback((content: string): string => {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const userMessage: OrchestratedMessage = {
      id,
      role: 'user',
      content,
      status: 'complete',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    return id;
  }, []);

  const createAssistantPlaceholder = useCallback((): string => {
    const id = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const assistantMessage: OrchestratedMessage = {
      id,
      role: 'assistant',
      content: '',
      status: 'pending',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, assistantMessage]);
    return id;
  }, []);

  const updateAssistant = useCallback((id: string, content: string, isComplete: boolean = false, rawMessage?: any) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === id
          ? { ...msg, content, status: isComplete ? 'complete' : 'streaming', rawMessage }
          : msg
      )
    );
  }, []);

  const finalizeAssistant = useCallback((id: string) => {
    setMessages(prev =>
      prev.map(msg => (msg.id === id ? { ...msg, status: 'complete' } : msg))
    );
  }, []);

  return {
    messages,
    appendUserMessage,
    createAssistantPlaceholder,
    updateAssistant,
    finalizeAssistant,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function extractCopilotText(msg: any): string {
  if (!msg || msg.content == null) return '';
  if (typeof msg.content === 'string') return msg.content;

  // Array format: [{ type: 'text', text: '...' }]
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part: any) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');
  }
  return '';
}

// ============================================================================
// Action Renderer - Renders UI based on action name
// ============================================================================

function renderActionByName(actionName: string, args: any): React.ReactNode {
  // Parse JSON fields safely
  const parseJson = (str: string | undefined, fallback: any = []) => {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  };

  switch (actionName) {
    case 'buildLEAPS': {
      const data = parseJson(args.dataJson, {});
      data.symbol = args.symbol;
      const step = typeof args.step === 'number' ? args.step : 0;
      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center gap-2">
            <span className="font-semibold text-sm">LEAPS Builder - Step {step + 1}</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800 text-sm">
            <div className="text-gray-600 dark:text-gray-400">
              {args.symbol} • {args.direction} • Budget: ${args.capitalBudget || 'Not set'}
            </div>
          </div>
        </div>
      );
    }

    case 'displayLeapsFilter': {
      const candidates = parseJson(args.candidatesJson, []);
      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white flex items-center gap-2">
            <span className="font-semibold text-sm">LEAPS Filter Results</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-2">
              <span className="font-medium text-blue-900 dark:text-blue-100">{args.symbol}</span>
              <div className="text-sm">
                <span className="text-green-600 dark:text-green-400 font-medium">{args.passedCount} passed</span>
                <span className="text-gray-400 mx-2">|</span>
                <span className="text-gray-500">{args.excludedCount} excluded</span>
              </div>
            </div>
            {candidates.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {candidates.slice(0, 5).map((c: any, i: number) => (
                  <div key={i} className="p-2 bg-gray-50 dark:bg-slate-700/50 rounded text-xs">
                    <div className="flex justify-between">
                      <span className="font-mono">{c.contract?.contractSymbol?.slice(-15)}</span>
                      <span>{c.contract?.dte} DTE</span>
                    </div>
                    <div className="text-gray-500 mt-1">
                      Strike: ${c.contract?.strike} • Delta: {c.contract?.delta?.toFixed(2)} • Mark: ${c.contract?.mark?.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'displayLeapsRanking': {
      const candidates = parseJson(args.candidatesJson, []);
      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white flex items-center gap-2">
            <span className="font-semibold text-sm">LEAPS Ranking</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800">
            <div className="space-y-2">
              {candidates.slice(0, 5).map((c: any, idx: number) => (
                <div key={idx} className={`p-2 rounded-lg border ${idx === 0 ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200' : 'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-600'}`}>{idx + 1}</span>
                      <span className="font-medium text-sm">${c.contract?.strike} {c.contract?.optionType}</span>
                    </div>
                    <span className="text-sm font-bold text-blue-600">{((c.overallScore ?? 0) / 100).toFixed(2)}</span>
                  </div>
                  {c.scores && (
                    <div className="grid grid-cols-4 gap-1 text-xs text-center">
                      <div><span className="text-gray-500">Theta:</span> {c.scores.thetaEfficiency?.toFixed(0)}</div>
                      <div><span className="text-gray-500">Delta:</span> {c.scores.deltaProbability?.toFixed(0)}</div>
                      <div><span className="text-gray-500">Liquid:</span> {c.scores.liquidity?.toFixed(0)}</div>
                      <div><span className="text-gray-500">R/R:</span> {c.scores.riskReward?.toFixed(0)}</div>
                    </div>
                  )}
                  {c.why?.[0] && <div className="text-xs text-green-600 mt-1">✓ {c.why[0]}</div>}
                  {c.riskFlags?.[0] && <div className="text-xs text-amber-600 mt-1">⚠ {c.riskFlags[0]}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case 'displayLeapsPayoff': {
      const simulations = parseJson(args.simulationsJson, []);
      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center gap-2">
            <span className="font-semibold text-sm">Payoff Simulation</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800">
            {simulations.slice(0, 3).map((sim: any, idx: number) => {
              const candidate = sim.candidate;
              const breakeven = Array.isArray(candidate?.breakeven) ? candidate.breakeven[0] : candidate?.breakeven;
              return (
              <div key={idx} className="p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg mb-2">
                <div className="flex justify-between mb-2">
                  <span className="font-medium text-sm">#{idx + 1} ${candidate?.legs?.[0]?.contract?.strike} {candidate?.legs?.[0]?.contract?.optionType}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="p-1.5 bg-white dark:bg-slate-800 rounded text-center">
                    <div className="text-gray-500">Breakeven</div>
                    <div className="font-bold">${breakeven?.toFixed(2)}</div>
                  </div>
                  <div className="p-1.5 bg-white dark:bg-slate-800 rounded text-center">
                    <div className="text-gray-500">Max Loss</div>
                    <div className="font-bold text-red-600">${Math.abs(candidate?.maxLoss ?? 0).toFixed(0)}</div>
                  </div>
                  <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded text-center">
                    <div className="text-gray-500">Expected Move</div>
                    <div className="font-bold text-blue-600">
                      {candidate?.expectedProfit?.horizonMovePct != null
                        ? `+${candidate.expectedProfit.horizonMovePct.toFixed(1)}%`
                        : 'N/A'}
                    </div>
                    {candidate?.expectedProfit?.expectedPriceAtExpiry != null && (
                      <div className="text-[10px] text-blue-400">→ ${candidate.expectedProfit.expectedPriceAtExpiry.toFixed(0)}</div>
                    )}
                  </div>
                  <div className="p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-center">
                    <div className="text-gray-500">Expected Profit</div>
                    <div className="font-bold text-green-600">
                      {candidate?.expectedProfit?.expectedProfitUsd != null
                        ? `$${candidate.expectedProfit.expectedProfitUsd.toFixed(0)}`
                        : candidate?.maxProfit === 'unlimited' ? '∞' : `$${candidate?.maxProfit}`}
                    </div>
                  </div>
                </div>
                {sim.scenarios && (
                  <div className="flex gap-1 flex-wrap">
                    {sim.scenarios.slice(0, 5).map((s: any, sIdx: number) => (
                      <span key={sIdx} className={`px-1.5 py-0.5 rounded text-xs ${s.pnl >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {s.move}: {s.roi >= 0 ? '+' : ''}{s.roi?.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
            })}
          </div>
        </div>
      );
    }

    case 'displayLeapsRisk': {
      const warnings = parseJson(args.warningsJson, []);
      const recommendations = parseJson(args.recommendationsJson, []);
      const riskColorMap: Record<string, string> = {
        low: 'bg-green-100 text-green-700',
        moderate: 'bg-yellow-100 text-yellow-700',
        high: 'bg-orange-100 text-orange-700',
        critical: 'bg-red-100 text-red-700',
      };
      const riskColor = riskColorMap[args.riskLevel as string] || 'bg-gray-100 text-gray-700';

      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-slate-500 to-slate-700 text-white flex items-center gap-2">
            <span className="font-semibold text-sm">Risk Assessment</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between p-2 bg-slate-100 dark:bg-slate-700 rounded-lg mb-2">
              <span className="font-medium">{args.symbol}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase ${riskColor}`}>{args.riskLevel}</span>
            </div>
            {args.ivRank !== undefined && (
              <div className="p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">IV Rank</span>
                  <span className="font-bold">{args.ivRank}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full">
                  <div className={`h-full rounded-full ${args.ivRank < 30 ? 'bg-green-500' : args.ivRank < 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${args.ivRank}%` }} />
                </div>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="space-y-1 mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase">Warnings</span>
                {warnings.map((w: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 p-1.5 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700">
                    <span>⚠</span><span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {recommendations.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-gray-500 uppercase">Recommendations</span>
                {recommendations.map((r: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700">
                    <span>→</span><span>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'displayAnalysis': {
      const sections = parseJson(args.sectionsJson, []);
      return (
        <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-green-500 to-teal-500 text-white">
            <span className="font-semibold text-sm">{args.title || 'Analysis'}</span>
          </div>
          <div className="p-3 bg-white dark:bg-slate-800">
            {sections.map((section: any, i: number) => (
              <div key={i} className="mb-2">
                <div className="font-medium text-sm text-gray-700 dark:text-gray-300">{section.heading}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{section.content}</div>
              </div>
            ))}
            {args.recommendation && (
              <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-300">
                <strong>Recommendation:</strong> {args.recommendation}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'displayMetrics':
    case 'displayStrategy':
    default:
      // Generic fallback for other actions
      return (
        <div className="my-2 p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
            <span className="font-medium text-green-700 dark:text-green-300">{actionName}</span>
          </div>
          {args.title && <div className="font-semibold text-gray-800 dark:text-gray-200 mb-1">{args.title}</div>}
          {args.symbol && <div className="text-sm text-gray-600 dark:text-gray-400">Symbol: {args.symbol}</div>}
        </div>
      );
  }
}

// ============================================================================
// Action Content Renderer
// ============================================================================

/**
 * Extracts and renders action results from CopilotKit message content.
 * Uses CopilotKit's lazy tool renderer to properly render action UI.
 */
function ActionContentRenderer({
  rawMessage,
  allMessages,
  getToolRenderer
}: {
  rawMessage: any;
  allMessages: any[];
  getToolRenderer: (message?: any, messages?: any[]) => (() => React.ReactElement | null) | null;
}) {
  if (!rawMessage) return null;

  // Use CopilotKit's lazy tool renderer to get the render function
  const renderToolCall = getToolRenderer(rawMessage, allMessages);

  if (renderToolCall) {
    // Call the render function to get the actual React element
    const rendered = renderToolCall();
    if (rendered) {
      return <div className="mt-2">{rendered}</div>;
    }
  }

  // Check for toolCalls field (CopilotKit's format for action invocations)
  if (rawMessage.toolCalls && Array.isArray(rawMessage.toolCalls)) {
    return (
      <div className="space-y-2 mt-2">
        {rawMessage.toolCalls.map((toolCall: any, idx: number) => {
          const functionName = toolCall.function?.name || toolCall.name || 'unknown';
          let args: any = {};
          try {
            args = typeof toolCall.function?.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function?.arguments || toolCall.args || {};
          } catch {
            args = {};
          }

          // Render based on the action name
          return (
            <div key={toolCall.id || idx}>
              {renderActionByName(functionName, args)}
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback: Check content array for action data
  const content = rawMessage.content;
  let actionParts: any[] = [];

  if (Array.isArray(content)) {
    actionParts = content.filter((part: any) => {
      if (!part) return false;
      const type = part.type?.toLowerCase() || '';
      return (
        type.includes('action') ||
        type.includes('tool') ||
        type.includes('function') ||
        type === 'ui' ||
        part.name ||
        part.actionName ||
        part.toolName
      );
    });
  }

  // Check for inProgress actions
  if (rawMessage.inProgressGeneration?.action) {
    actionParts.push({
      ...rawMessage.inProgressGeneration.action,
      status: 'executing'
    });
  }

  // Check for completed action results
  if (rawMessage.actionResults) {
    actionParts = actionParts.concat(
      Object.values(rawMessage.actionResults).map((r: any) => ({
        ...r,
        status: 'complete'
      }))
    );
  }

  if (actionParts.length === 0) return null;

  return (
    <div className="space-y-2 mt-2">
      {actionParts.map((part: any, idx: number) => {
        if (React.isValidElement(part.render)) {
          return <div key={idx}>{part.render}</div>;
        }
        if (React.isValidElement(part.component)) {
          return <div key={idx}>{part.component}</div>;
        }

        const actionName = part.name || part.actionName || part.toolName || 'unknown';
        const status = part.status || (part.result ? 'complete' : 'executing');
        const args = part.args || part.arguments || {};
        const result = part.result;

        return (
          <div
            key={idx}
            className={`p-3 rounded-lg border ${
              status === 'executing'
                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 animate-pulse'
                : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              {status === 'executing' ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-xs">✓</span>
              )}
              <span className={`font-medium ${status === 'executing' ? 'text-blue-700 dark:text-blue-300' : 'text-green-700 dark:text-green-300'}`}>
                {actionName}
              </span>
              {args.symbol && (
                <span className="text-xs bg-white dark:bg-slate-700 px-2 py-0.5 rounded">
                  {args.symbol}
                </span>
              )}
            </div>
            {result && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {typeof result === 'object' ? (
                  <pre className="overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
                ) : (
                  String(result)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Floating Toggle Button (shown when chat is closed on mobile)
// ============================================================================

function FloatingToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50 hover:scale-105 lg:hidden"
      aria-label="Open chat"
    >
      <MessageSquare className="w-6 h-6" />
    </button>
  );
}

// ============================================================================
// Chat Panel Content (shared between docked and overlay modes)
// ============================================================================

interface ChatPanelContentProps {
  orchestratedMessages: OrchestratedMessage[];
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputDisabled: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  mode: 'docked' | 'overlay';
  // For rendering CopilotKit action content
  copilotMessages: any[];
  getToolRenderer: (message?: any, messages?: any[]) => (() => React.ReactElement | null) | null;
}

function ChatPanelContent({
  orchestratedMessages,
  inputValue,
  setInputValue,
  handleSubmit,
  handleKeyDown,
  inputDisabled,
  inputRef,
  messagesEndRef,
  onClose,
  mode,
  copilotMessages,
  getToolRenderer,
}: ChatPanelContentProps) {
  return (
    <>
      {/* Header */}
      <div className={`relative flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white ${mode === 'overlay' ? 'rounded-t-2xl' : ''}`}>
        {mode === 'overlay' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-white/30 rounded-full" />
        )}
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <span className="font-semibold">ChainCopilot</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          aria-label="Close chat"
        >
          {mode === 'docked' ? <PanelRightClose className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-900">
        {/* Initial message */}
        {orchestratedMessages.length === 0 && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg rounded-tl-none p-3 text-sm text-gray-700 dark:text-gray-300 shadow-sm max-w-[85%]">
              {CHAT_WELCOME_MESSAGE}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {orchestratedMessages.map(message => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'user'
                  ? 'bg-gray-200 dark:bg-slate-700'
                  : 'bg-blue-100 dark:bg-blue-900'
              }`}
            >
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              ) : (
                <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              )}
            </div>

            <div
              className={`rounded-lg p-3 text-sm shadow-sm max-w-[85%] overflow-hidden ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white rounded-tr-none'
                  : 'bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200 rounded-tl-none'
              }`}
            >
              {message.content ? (
                <MessageRenderer content={message.content} role={message.role} />
              ) : message.status !== 'complete' ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-gray-500 dark:text-gray-400">Thinking...</span>
                </div>
              ) : null}

              {/* Render action content from raw CopilotKit message */}
              {message.role === 'assistant' && message.rawMessage && (
                <ActionContentRenderer
                  rawMessage={message.rawMessage}
                  allMessages={copilotMessages}
                  getToolRenderer={getToolRenderer}
                />
              )}

              {message.status === 'streaming' && message.content && (
                <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about options, strategies, Greeks..."
            className="flex-1 px-4 py-2.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            disabled={inputDisabled}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || inputDisabled}
            className="px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-md"
          >
            {inputDisabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ChatOrchestrator({ isOpen, onOpenChange, mode }: ChatOrchestratorProps) {
  const [inputValue, setInputValue] = useState('');
  const [inFlight, setInFlight] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentAssistantIdRef = useRef<string | null>(null);
  const sendStartIndexRef = useRef<number>(0);
  const contentSnapshotRef = useRef<string>('');
  const currentResponseRef = useRef<string>('');
  const lastProcessedMsgIdRef = useRef<string | null>(null);

  const [openTime] = useState(() => new Date().toISOString());

  const {
    messages: orchestratedMessages,
    appendUserMessage,
    createAssistantPlaceholder,
    updateAssistant,
    finalizeAssistant,
  } = useMessageOrchestrator();

  // Get options chain context for AI awareness
  const { chainSummary, selectedContracts } = useOptionsChain();

  useCopilotReadable({
    description: 'Current date and time for context',
    value: openTime,
  });

  // Expose current options chain view to AI
  useCopilotReadable({
    description: 'User current options chain view - what symbol, expiration, and contracts they are looking at',
    value: chainSummary ? {
      symbol: chainSummary.symbol,
      underlyingPrice: chainSummary.underlyingPrice,
      currentExpiration: chainSummary.currentExpiration,
      currentExpirationDte: chainSummary.currentExpirationDte,
      isViewingLeaps: chainSummary.isViewingLeaps,
      leapsExpirations: chainSummary.leapsExpirations,
      totalCalls: chainSummary.totalCalls,
      totalPuts: chainSummary.totalPuts,
      selectedContractsCount: selectedContracts.length,
      selectedContracts: selectedContracts.map(c => ({
        symbol: c.contractSymbol,
        strike: c.strike,
        expiration: c.expiration,
        type: c.optionType,
        delta: c.delta,
        dte: c.dte,
      })),
    } : null,
  });

  useCopilotAdditionalInstructions({
    instructions: COPILOT_INSTRUCTIONS,
  });

  useOptionsActions();

  const { messages: copilotMessages, sendMessage, isLoading } = useCopilotChatInternal();

  // Get the lazy tool renderer for rendering action/tool calls
  const getToolRenderer = useLazyToolRenderer();

  // --- Sync CopilotKit -> Orchestrated UI ---
  useEffect(() => {
    const assistantId = currentAssistantIdRef.current;
    if (!assistantId) return;

    const checkContent = () => {
      const msgs = (copilotMessages ?? []) as any[];
      const allAssistants = msgs.filter(m => m?.role === 'assistant');
      const allAssistantContent = allAssistants
        .map(a => extractCopilotText(a))
        .join('');

      const snapshot = contentSnapshotRef.current;
      let newContent = '';

      if (allAssistantContent.startsWith(snapshot)) {
        newContent = allAssistantContent.slice(snapshot.length).trim();
      } else if (allAssistantContent.length > snapshot.length) {
        newContent = allAssistantContent.slice(snapshot.length).trim();
      } else {
        newContent = '';
      }

      // Get the latest assistant message for raw content (including action renders)
      const latestAssistant = allAssistants.length > 0 ? allAssistants[allAssistants.length - 1] : null;

      // Check if there are toolCalls even without text content
      const hasToolCalls = latestAssistant?.toolCalls && latestAssistant.toolCalls.length > 0;
      const latestMsgId = latestAssistant?.id;
      const alreadyProcessed = latestMsgId && latestMsgId === lastProcessedMsgIdRef.current;

      if (newContent && newContent !== currentResponseRef.current) {
        currentResponseRef.current = newContent;
        updateAssistant(assistantId, newContent, false, latestAssistant);
      } else if (hasToolCalls && !alreadyProcessed && !currentResponseRef.current) {
        // AI responded with only tool calls, no text - still update with rawMessage (only once)
        lastProcessedMsgIdRef.current = latestMsgId;
        updateAssistant(assistantId, '', false, latestAssistant);
      }

      // Finalize when loading is done - check for content OR toolCalls
      if (!isLoading && (currentResponseRef.current || hasToolCalls)) {
        // Pass the latest raw message when finalizing
        updateAssistant(assistantId, currentResponseRef.current || '', true, latestAssistant);
        currentAssistantIdRef.current = null;
        currentResponseRef.current = '';
        lastProcessedMsgIdRef.current = null;
        setInFlight(false);
        return true;
      }
      return false;
    };

    if (checkContent()) return;

    const interval = setInterval(() => {
      if (!currentAssistantIdRef.current || checkContent()) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [copilotMessages, isLoading, updateAssistant, finalizeAssistant]);

  // Timeout
  useEffect(() => {
    if (!inFlight) return;

    const assistantId = currentAssistantIdRef.current;
    if (!assistantId) return;

    const timeout = setTimeout(() => {
      if (currentAssistantIdRef.current === assistantId) {
        updateAssistant(assistantId, 'System is busy, please try again later.', true);
        currentAssistantIdRef.current = null;
        currentResponseRef.current = '';
        setInFlight(false);
      }
    }, 30000);

    return () => clearTimeout(timeout);
  }, [inFlight, updateAssistant]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [orchestratedMessages, inFlight]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Submit handler
  const submitText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (inFlight) return;

      setInFlight(true);

      sendStartIndexRef.current = ((copilotMessages ?? []) as any[]).length;

      const msgs = (copilotMessages ?? []) as any[];
      const allAssistants = msgs.filter(m => m?.role === 'assistant');
      contentSnapshotRef.current = allAssistants
        .map(a => extractCopilotText(a))
        .join('');

      appendUserMessage(text);
      const assistantId = createAssistantPlaceholder();
      currentAssistantIdRef.current = assistantId;
      currentResponseRef.current = '';
      lastProcessedMsgIdRef.current = null;

      try {
        // sendMessage expects a Message object in useCopilotChatInternal
        await sendMessage({
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'user',
          content: text,
        } as any);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateAssistant(assistantId, `Error: ${errorMsg}`, true);
        currentAssistantIdRef.current = null;
        currentResponseRef.current = '';
        setInFlight(false);
      }
    },
    [
      inFlight,
      copilotMessages,
      appendUserMessage,
      createAssistantPlaceholder,
      sendMessage,
      updateAssistant,
    ]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputValue;
      setInputValue('');
      submitText(text);
    },
    [inputValue, submitText]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = inputValue;
        setInputValue('');
        submitText(text);
      }
    },
    [inputValue, submitText]
  );

  const inputDisabled = inFlight;

  // Docked mode (desktop): renders inline in the flex layout
  if (mode === 'docked') {
    if (!isOpen) {
      // Show a small toggle button in the header area (handled by parent)
      return null;
    }

    return (
      <div className="fixed top-0 right-0 bottom-0 w-[380px] bg-white dark:bg-slate-800 border-l border-gray-200 dark:border-slate-700 flex flex-col overflow-hidden z-50 shadow-lg">
        <ChatPanelContent
          orchestratedMessages={orchestratedMessages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          handleSubmit={handleSubmit}
          handleKeyDown={handleKeyDown}
          inputDisabled={inputDisabled}
          inputRef={inputRef}
          messagesEndRef={messagesEndRef}
          onClose={() => onOpenChange(false)}
          mode="docked"
          copilotMessages={(copilotMessages ?? []) as any[]}
          getToolRenderer={getToolRenderer}
        />
      </div>
    );
  }

  // Overlay mode (mobile/tablet): fixed position
  if (!isOpen) {
    return <FloatingToggle onClick={() => onOpenChange(true)} />;
  }

  return (
    <div>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={() => onOpenChange(false)}
      />

      {/* Bottom sheet */}
      <div className="fixed z-50 bg-white dark:bg-slate-800 shadow-2xl flex flex-col overflow-hidden left-0 right-0 bottom-0 h-[80dvh] w-full rounded-t-2xl border-t border-gray-200 dark:border-slate-700 transition-transform duration-300 ease-out">
        <ChatPanelContent
          orchestratedMessages={orchestratedMessages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          handleSubmit={handleSubmit}
          handleKeyDown={handleKeyDown}
          inputDisabled={inputDisabled}
          inputRef={inputRef}
          messagesEndRef={messagesEndRef}
          onClose={() => onOpenChange(false)}
          mode="overlay"
          copilotMessages={(copilotMessages ?? []) as any[]}
          getToolRenderer={getToolRenderer}
        />
      </div>
    </div>
  );
}

export default ChatOrchestrator;
