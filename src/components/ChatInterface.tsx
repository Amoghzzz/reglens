'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FormattedAnswer } from './FormattedAnswer';
import { SourceDrawer } from './SourceDrawer';
import { Citation, QAResult } from '@/lib/qa';
import { SearchResult } from '@/lib/search';
import {
  Send,
  Sparkles,
  Shield,
  RotateCcw,
  BookOpen,
  ArrowRight,
  MessageSquare,
  Building2,
  FileText
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  unverifiedCitations?: Citation[];
  retrievedResults?: SearchResult[];
  timeTakenMs?: number;
  modelUsed?: string;
  isNotFound?: boolean;
  isStreaming?: boolean;
}

const EXAMPLE_QUESTIONS = [
  'What is the maximum exposure an NBFC can have to a single party?',
  'What is the maximum tenor of a bullet repayment gold loan?',
  'Above what loan amount must an NBFC do a detailed credit assessment for gold loans?',
  'What is the current repo rate?'
];

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Source drawer state
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<SearchResult['chunk'] | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleOpenSource = (citation: Citation, chunk: SearchResult['chunk']) => {
    setSelectedCitation(citation);
    setSelectedChunk(chunk);
    setIsDrawerOpen(true);
  };

  const handleSend = async (questionText?: string) => {
    const query = (questionText || input).trim();
    if (!query || isLoading) return;

    setInput('');
    setError(null);

    const userMessageId = `user_${Date.now()}`;
    const assistantMessageId = `assistant_${Date.now()}`;

    // Add user message & empty assistant placeholder
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'user', content: query },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        citations: [],
        unverifiedCitations: [],
        retrievedResults: [],
        isStreaming: true
      }
    ]);

    setIsLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, stream: true })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body returned from server.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.replace('data: ', '').trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'token') {
              accumulatedContent += event.content;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: accumulatedContent }
                    : msg
                )
              );
            } else if (event.type === 'done') {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        content: event.answer,
                        citations: event.citations || [],
                        unverifiedCitations: event.unverifiedCitations || [],
                        retrievedResults: event.retrievedResults || [],
                        timeTakenMs: event.timeTakenMs,
                        modelUsed: event.modelUsed,
                        isNotFound: event.isNotFound,
                        isStreaming: false
                      }
                    : msg
                )
              );
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e: any) {
            console.error('Error parsing SSE event:', e);
          }
        }
      }
    } catch (err: any) {
      console.error('Query error:', err);
      setError(err.message || 'Failed to retrieve response.');
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: `Error: ${err.message || 'An unexpected error occurred.'}`,
                isStreaming: false
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950 font-sans text-zinc-900 dark:text-zinc-100 antialiased">
      {/* 1. Header */}
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
              <Shield className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
                  RegLens
                </span>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  RBI NBFC Intelligence
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Answers from 35 RBI Master Directions for NBFCs (updated to Oct 2026). Information only, not legal advice.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Reset conversation"
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Welcome view when empty */}
          {messages.length === 0 && (
            <div className="py-8 text-center space-y-6">
              <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 shadow-xs border border-zinc-200 dark:border-zinc-700">
                <Building2 className="size-7 text-emerald-600 dark:text-emerald-400" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-2xl">
                  RBI Master Directions Compliance Assistant
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
                  Ask specific questions about exposure limits, gold loans, liquidity, capital adequacy, or governance across all 35 RBI Master Directions for NBFCs.
                </p>
              </div>

              {/* 4 Example questions as clickable chips */}
              <div className="pt-2 text-left space-y-2.5 max-w-xl mx-auto">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                  Try asking one of these:
                </div>
                <div className="grid gap-2">
                  {EXAMPLE_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(q)}
                      className="group flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3.5 text-left text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 hover:text-emerald-900 dark:hover:text-emerald-200 shadow-2xs transition-all cursor-pointer"
                    >
                      <span className="font-medium pr-3 leading-snug">{q}</span>
                      <ArrowRight className="size-4 shrink-0 text-zinc-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Message List */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col ${
                message.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {message.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm text-white dark:text-zinc-900 shadow-xs font-medium">
                  {message.content}
                </div>
              ) : (
                <div className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/80 p-5 shadow-xs">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="size-6 rounded-md bg-emerald-600 text-white flex items-center justify-center">
                      <Shield className="size-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      RegLens Regulatory Answer
                    </span>
                    {message.isStreaming && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Generating response...
                      </span>
                    )}
                  </div>

                  <FormattedAnswer
                    answer={message.content}
                    citations={message.citations || []}
                    unverifiedCitations={message.unverifiedCitations || []}
                    retrievedResults={message.retrievedResults || []}
                    timeTakenMs={message.timeTakenMs}
                    modelUsed={message.modelUsed}
                    isNotFound={message.isNotFound}
                    isStreaming={message.isStreaming}
                    onCitationClick={handleOpenSource}
                  />
                </div>
              )}
            </div>
          ))}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 p-4 text-xs text-rose-800 dark:text-rose-300">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 3. Input Footer */}
      <footer className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md p-4">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Example clickable chips above input box */}
          {messages.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <span className="text-[11px] font-semibold text-zinc-400 shrink-0">Quick Queries:</span>
              {EXAMPLE_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(q)}
                  disabled={isLoading}
                  className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-1 text-zinc-700 dark:text-zinc-300 text-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {q.length > 38 ? `${q.substring(0, 36)}...` : q}
                </button>
              ))}
            </div>
          )}

          {/* Input text area */}
          <div className="relative flex items-center rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-xs focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about RBI NBFC regulations (e.g. exposure limits, gold loan tenors)..."
              disabled={isLoading}
              rows={1}
              className="w-full resize-none bg-transparent py-3 pl-4 pr-12 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden max-h-32 min-h-[46px]"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="absolute right-2.5 flex size-8 items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-white disabled:text-zinc-400 transition-colors shadow-2xs cursor-pointer disabled:cursor-not-allowed"
              title="Send question"
            >
              <Send className="size-4" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
            <span>Press Enter to send, Shift + Enter for new line</span>
            <span>Grounding: 35 RBI Master Directions • Rate limit: 10/hr</span>
          </div>
        </div>
      </footer>

      {/* 4. Side Drawer for Sources */}
      <SourceDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        citation={selectedCitation}
        chunk={selectedChunk}
      />
    </div>
  );
}
