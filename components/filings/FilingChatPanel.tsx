'use client';

/**
 * FilingChatPanel - Chat panel for SEC filing analysis
 *
 * Uses the Python Fundamental Agent for AI-powered filing analysis.
 * Flow: FilingChatPanel → /api/filings/chat → Python Agent → Tools
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2, Bot, User, PanelRightClose, ExternalLink } from 'lucide-react';
import { useFilingChat, ChatMessage } from './useFilingChat';
import { useFilingContext } from './FilingContext';
import { MessageRenderer } from '@/components/chat/MessageRenderer';

interface FilingChatPanelProps {
  welcomeMessage: string;
  placeholder?: string;
  onClose: () => void;
}

export function FilingChatPanel({ welcomeMessage, placeholder, onClose }: FilingChatPanelProps) {
  const { selectSection } = useFilingContext();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    hasFilingContext,
  } = useFilingChat({
    onNavigate: selectSection,
  });

  // Focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputValue.trim() || isLoading) return;
      const text = inputValue;
      setInputValue('');
      sendMessage(text);
    },
    [inputValue, isLoading, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!inputValue.trim() || isLoading) return;
        const text = inputValue;
        setInputValue('');
        sendMessage(text);
      }
    },
    [inputValue, isLoading, sendMessage]
  );

  return (
    <>
      {/* Header */}
      <div className="relative flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <span className="font-semibold">Filing Analyst</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          aria-label="Close chat"
        >
          <PanelRightClose className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-900">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg rounded-tl-none p-3 text-sm text-gray-700 dark:text-gray-300 shadow-sm max-w-[85%] whitespace-pre-line">
              {welcomeMessage}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((message) => (
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
              ) : message.isStreaming ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-gray-500 dark:text-gray-400">Analyzing...</span>
                </div>
              ) : null}

              {/* Show citations for assistant messages */}
              {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Sources:</div>
                  <div className="flex flex-wrap gap-1">
                    {message.citations.map((cite, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectSection(cite.sectionId)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {cite.sectionLabel || cite.sectionId}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {message.isStreaming && message.content && (
                <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          </div>
        ))}

        {/* Error message */}
        {error && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 shadow-sm max-w-[85%]">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      >
        {!hasFilingContext && (
          <div className="text-xs text-amber-600 dark:text-amber-400 mb-2">
            No filing loaded. Select a filing to enable AI analysis.
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Ask about the filing...'}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-md"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </>
  );
}

export default FilingChatPanel;
