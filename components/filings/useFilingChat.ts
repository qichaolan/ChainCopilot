/**
 * useFilingChat Hook
 *
 * Custom hook for SEC filing chat that uses the Python Fundamental Agent.
 * Provides streaming responses and integrates with the filing context.
 */

import { useState, useCallback, useRef } from "react";
import { useFilingContext } from "./FilingContext";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Array<{
    sectionId: string;
    sectionLabel: string;
    snippet: string;
  }>;
  isStreaming?: boolean;
}

interface UseFilingChatOptions {
  onNavigate?: (sectionId: string) => void;
}

export function useFilingChat(options: UseFilingChatOptions = {}) {
  const { manifest, selectedSectionId, sectionContent } = useFilingContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const filingId = manifest
    ? `${manifest.ticker}-${manifest.form_type}-${manifest.filed_at}`
    : null;

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Create user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
      };

      // Create placeholder for assistant response
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsLoading(true);
      setError(null);

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch("/api/filings/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: content.trim() },
            ],
            filingId,
            currentSectionId: selectedSectionId,
            currentSectionContent: sectionContent?.section.text,
            thread_id: threadIdRef.current,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          // Handle non-JSON error responses (like 404 HTML pages)
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let fullContent = "";
        let citations: ChatMessage["citations"] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                switch (data.type) {
                  case "content":
                    fullContent = data.content;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessage.id
                          ? { ...m, content: fullContent, isStreaming: true }
                          : m
                      )
                    );
                    break;

                  case "citations":
                    citations = data.content;
                    break;

                  case "done":
                    if (data.thread_id) {
                      threadIdRef.current = data.thread_id;
                    }
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessage.id
                          ? { ...m, content: fullContent, citations, isStreaming: false }
                          : m
                      )
                    );
                    break;

                  case "error":
                    throw new Error(data.content);

                  case "ui_action":
                    if (data.content?.action === "navigate" && options.onNavigate) {
                      options.onNavigate(data.content.sectionId);
                    }
                    break;
                }
              } catch (parseError) {
                // Skip invalid JSON lines
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was aborted, ignore
          return;
        }

        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);

        // Update assistant message with error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: `Error: ${errorMessage}`, isStreaming: false }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [messages, filingId, selectedSectionId, sectionContent, options]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    threadIdRef.current = null;
    setError(null);
  }, []);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    stopStreaming,
    hasFilingContext: !!filingId,
  };
}
