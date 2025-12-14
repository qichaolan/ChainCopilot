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
  useCopilotChatInternal,
} from '@copilotkit/react-core';
import { Send, X, Loader2, MessageSquare, Bot, User, PanelRightClose } from 'lucide-react';
import { COPILOT_INSTRUCTIONS, CHAT_WELCOME_MESSAGE } from '@/lib/ai/prompts';
import { MessageRenderer } from './MessageRenderer';
import { useOptionsActions } from './actions/useOptionsActions';

// ============================================================================
// Types
// ============================================================================

interface OrchestratedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'streaming' | 'complete';
  timestamp: number;
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

  const updateAssistant = useCallback((id: string, content: string, isComplete: boolean = false) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === id
          ? { ...msg, content, status: isComplete ? 'complete' : 'streaming' }
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

  const [openTime] = useState(() => new Date().toISOString());

  const {
    messages: orchestratedMessages,
    appendUserMessage,
    createAssistantPlaceholder,
    updateAssistant,
    finalizeAssistant,
  } = useMessageOrchestrator();

  useCopilotReadable({
    description: 'Current date and time for context',
    value: openTime,
  });

  useCopilotAdditionalInstructions({
    instructions: COPILOT_INSTRUCTIONS,
  });

  useOptionsActions();

  const { messages: copilotMessages, sendMessage, isLoading } = useCopilotChatInternal();

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

      if (newContent && newContent !== currentResponseRef.current) {
        currentResponseRef.current = newContent;
        updateAssistant(assistantId, newContent, false);
      }

      if (!isLoading && currentResponseRef.current) {
        finalizeAssistant(assistantId);
        currentAssistantIdRef.current = null;
        currentResponseRef.current = '';
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

      try {
        await sendMessage({
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'user',
          content: text,
        });
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
        />
      </div>
    </div>
  );
}

export default ChatOrchestrator;
