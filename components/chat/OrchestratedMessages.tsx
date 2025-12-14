'use client';

/**
 * OrchestratedMessages - Custom Messages component for CopilotSidebar
 *
 * Implements append-only message tracking to guarantee ordering:
 * - Messages are added in the order they first appear
 * - Content updates don't affect order
 * - User messages always stay before their assistant responses
 */

import React, { useEffect, useRef } from 'react';
import { useCopilotChatInternal } from '@copilotkit/react-core';
import { Loader2 } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming: boolean;
}

interface MessagesProps {
  inProgress?: boolean;
  children?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

export function OrchestratedMessages({ inProgress, children }: MessagesProps) {
  // Use ref to track seen message IDs and their order (append-only)
  const seenIdsRef = useRef<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const forceUpdateRef = useRef(0);

  const { messages, isLoading } = useCopilotChatInternal();
  const copilotMessages = messages || [];

  // Build ordered display messages
  const displayMessages: DisplayMessage[] = [];

  // First, add any new message IDs to our ordered list (append-only)
  copilotMessages.forEach((msg) => {
    if ((msg.role === 'user' || msg.role === 'assistant') && msg.id) {
      if (!seenIdsRef.current.includes(msg.id)) {
        seenIdsRef.current.push(msg.id);
      }
    }
  });

  // Build display messages in our tracked order
  seenIdsRef.current.forEach((id) => {
    const msg = copilotMessages.find((m) => m.id === id);
    if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const isLastMessage = copilotMessages[copilotMessages.length - 1]?.id === id;

      displayMessages.push({
        id: msg.id,
        role: msg.role,
        content,
        isStreaming: msg.role === 'assistant' && isLastMessage && isLoading,
      });
    }
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [copilotMessages.length, inProgress]);

  return (
    <div className="copilotKitMessages" ref={containerRef}>
      <div className="copilotKitMessagesContainer">
        {/* Initial greeting if no messages */}
        {displayMessages.length === 0 && !inProgress && (
          <div className="copilotKitMessage copilotKitAssistantMessage">
            <div className="copilotKitMessageContent">
              Hi! I'm your AI options trading assistant. Ask me about options strategies, market analysis, or specific trades.
            </div>
          </div>
        )}

        {/* Display messages in tracked order */}
        {displayMessages.map((message) => (
          <div
            key={message.id}
            className={`copilotKitMessage ${
              message.role === 'user'
                ? 'copilotKitUserMessage'
                : 'copilotKitAssistantMessage'
            }`}
          >
            <div className="copilotKitMessageContent">
              {message.content || (
                message.isStreaming ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                ) : null
              )}
              {message.isStreaming && message.content && (
                <span className="copilotKitCursor" />
              )}
            </div>
          </div>
        ))}

        {/* Show loading placeholder when waiting for assistant response */}
        {inProgress && displayMessages.length > 0 &&
         displayMessages[displayMessages.length - 1]?.role === 'user' && (
          <div className="copilotKitMessage copilotKitAssistantMessage">
            <div className="copilotKitMessageContent">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
      <footer className="copilotKitMessagesFooter">
        {children}
      </footer>
    </div>
  );
}

export default OrchestratedMessages;
