'use client';

/**
 * Shared Chat Components and Hooks
 *
 * Common code used by both ChatOrchestrator (home page) and FilingChatPanel (fundamental page)
 * to ensure consistent UX across the application.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User, PanelRightClose, X } from 'lucide-react';
import { MessageRenderer } from './MessageRenderer';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'streaming' | 'complete';
  timestamp: number;
  rawMessage?: any;
}

// ============================================================================
// Message Orchestrator Hook
// ============================================================================

export function useMessageOrchestrator() {
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
// Helper Functions
// ============================================================================

export function extractCopilotText(msg: any): string {
  if (!msg || msg.content == null) return '';
  if (typeof msg.content === 'string') return msg.content;

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part: any) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');
  }
  return '';
}

// ============================================================================
// Chat Panel Content Component
// ============================================================================

interface ChatPanelContentProps {
  messages: OrchestratedMessage[];
  welcomeMessage: string;
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputDisabled: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  mode?: 'docked' | 'overlay';
  placeholder?: string;
  /** Optional: render additional content for action results */
  renderActionContent?: (message: OrchestratedMessage) => React.ReactNode;
}

export function ChatPanelContent({
  messages,
  welcomeMessage,
  inputValue,
  setInputValue,
  handleSubmit,
  handleKeyDown,
  inputDisabled,
  inputRef,
  messagesEndRef,
  onClose,
  mode = 'docked',
  placeholder = 'Ask a question...',
  renderActionContent,
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
        {messages.map(message => (
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

              {/* Render action content if provided */}
              {message.role === 'assistant' && renderActionContent && renderActionContent(message)}

              {message.status === 'streaming' && message.content && (
                <span className="inline-block w-1 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
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
// Chat Logic Hook - Handles CopilotKit integration
// ============================================================================

interface UseChatLogicOptions {
  copilotMessages: any[];
  isLoading: boolean;
  sendMessage: (message: any) => Promise<void>;
  orchestrator: ReturnType<typeof useMessageOrchestrator>;
}

export function useChatLogic({ copilotMessages, isLoading, sendMessage, orchestrator }: UseChatLogicOptions) {
  const [inputValue, setInputValue] = useState('');
  const [inFlight, setInFlight] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentAssistantIdRef = useRef<string | null>(null);
  const contentSnapshotRef = useRef<string>('');
  const currentResponseRef = useRef<string>('');
  const lastProcessedMsgIdRef = useRef<string | null>(null);

  const { appendUserMessage, createAssistantPlaceholder, updateAssistant } = orchestrator;

  // Sync CopilotKit messages to orchestrated UI
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
      }

      const latestAssistant = allAssistants.length > 0 ? allAssistants[allAssistants.length - 1] : null;
      const hasToolCalls = latestAssistant?.toolCalls && latestAssistant.toolCalls.length > 0;
      const latestMsgId = latestAssistant?.id;
      const alreadyProcessed = latestMsgId && latestMsgId === lastProcessedMsgIdRef.current;

      if (newContent && newContent !== currentResponseRef.current) {
        currentResponseRef.current = newContent;
        updateAssistant(assistantId, newContent, false, latestAssistant);
      } else if (hasToolCalls && !alreadyProcessed && !currentResponseRef.current) {
        lastProcessedMsgIdRef.current = latestMsgId;
        updateAssistant(assistantId, '', false, latestAssistant);
      }

      if (!isLoading && (currentResponseRef.current || hasToolCalls)) {
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
  }, [copilotMessages, isLoading, updateAssistant]);

  // Timeout handler
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
  }, [orchestrator.messages, inFlight]);

  // Submit handler
  const submitText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || inFlight) return;

      setInFlight(true);

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
    [inFlight, copilotMessages, appendUserMessage, createAssistantPlaceholder, sendMessage, updateAssistant]
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

  return {
    inputValue,
    setInputValue,
    inFlight,
    messagesEndRef,
    inputRef,
    handleSubmit,
    handleKeyDown,
  };
}
