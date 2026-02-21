import { useState, useCallback, useRef } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenClawConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_CONFIG: OpenClawConfig = {
  apiUrl: process.env.OPENCLAW_API_URL || 'https://ai.naisu.one/v1/chat/completions',
  apiKey: process.env.OPENCLAW_API_KEY || '',
  model: 'openai-codex/gpt-5.2',
};

export function useOpenClaw(config?: Partial<OpenClawConfig>) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim()) return;

    setError(null);
    setStreamingContent('');
    setIsLoading(true);

    const newUserMsg: ChatMessage = { role: 'user', content: userMessage };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);

    // Build the request messages payload
    const requestMessages = updatedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Abort any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (mergedConfig.apiKey) {
        headers['Authorization'] = `Bearer ${mergedConfig.apiKey}`;
      }

      const response = await fetch(mergedConfig.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: mergedConfig.model,
          messages: requestMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errText = response.statusText;
        try {
          const text = await response.text();
          if (text) errText = text;
        } catch {
          // Use statusText as fallback
        }
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      // Handle SSE streaming
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              setStreamingContent(assistantContent);
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      // Finalize: add assistant message to history
      if (assistantContent) {
        const assistantMsg: ChatMessage = { role: 'assistant', content: assistantContent };
        setMessages((prev) => [...prev, assistantMsg]);
      }
      setStreamingContent('');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Request was cancelled, not an error
        return;
      }
      
      let errorMessage = 'Unknown error occurred';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      // Check for CORS error
      if (err instanceof TypeError && err.message.includes('fetch')) {
        errorMessage = 'Network error: Check CORS or server availability';
      }
      
      console.error('OpenClaw API Error:', err);
      setError(errorMessage);

      // Try non-streaming fallback
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (mergedConfig.apiKey) {
          headers['Authorization'] = `Bearer ${mergedConfig.apiKey}`;
        }

        const fallbackResponse = await fetch(mergedConfig.apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: mergedConfig.model,
            messages: requestMessages,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (fallbackResponse.ok) {
          const json = await fallbackResponse.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            setError(null);
            const assistantMsg: ChatMessage = { role: 'assistant', content };
            setMessages((prev) => [...prev, assistantMsg]);
          }
        }
      } catch {
        // Fallback also failed, keep original error
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, mergedConfig.apiUrl, mergedConfig.apiKey, mergedConfig.model]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setStreamingContent('');
    setIsLoading(false);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
    setStreamingContent('');
  }, []);

  return {
    messages,
    isLoading,
    error,
    streamingContent,
    sendMessage,
    reset,
    cancel,
  };
}
