'use client';

import React from 'react';
import { Citation } from '@/lib/qa';
import { SearchResult } from '@/lib/search';
import { ShieldCheck, AlertCircle, FileSearch, Clock, Sparkles } from 'lucide-react';

interface FormattedAnswerProps {
  answer: string;
  citations: Citation[];
  unverifiedCitations: Citation[];
  retrievedResults: SearchResult[];
  timeTakenMs?: number;
  modelUsed?: string;
  isNotFound?: boolean;
  isStreaming?: boolean;
  onCitationClick: (citation: Citation, chunk: SearchResult['chunk']) => void;
}

export function FormattedAnswer({
  answer,
  citations,
  unverifiedCitations,
  retrievedResults,
  timeTakenMs,
  modelUsed,
  isNotFound,
  isStreaming,
  onCitationClick
}: FormattedAnswerProps) {
  // Check if answer is "Not found"
  const notFound =
    isNotFound ||
    answer.trim().startsWith('Not found in the indexed RBI NBFC Directions') ||
    answer.trim() === 'Not found in the indexed RBI NBFC Directions.';

  // Map chunk lookup
  const chunkMap = new Map<string, SearchResult['chunk']>();
  for (const r of retrievedResults) {
    chunkMap.set(r.chunk.id, r.chunk);
  }

  // Handle distinct neutral presentation for "Not found"
  if (notFound && !isStreaming) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-zinc-200/80 dark:bg-zinc-800 p-2 text-zinc-600 dark:text-zinc-400 shrink-0">
              <FileSearch className="size-5" />
            </div>
            <div className="space-y-1.5">
              <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                Not found in the indexed RBI NBFC Directions
              </h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                The indexed 35 RBI Master Directions for Non-Banking Financial Companies do not contain regulatory provisions answering this query. RegLens only answers from the regulatory documents in the index.
              </p>
              <div className="pt-2">
                <span className="inline-block rounded-md bg-zinc-200/60 dark:bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Information only, not legal advice.
                </span>
              </div>
            </div>
          </div>
        </div>

        {timeTakenMs !== undefined && (
          <div className="flex items-center gap-3 text-xs text-zinc-400 pl-1">
            <span className="flex items-center gap-1 font-mono">
              <Clock className="size-3" />
              {(timeTakenMs / 1000).toFixed(2)}s
            </span>
            <span>•</span>
            <span className="font-mono">{modelUsed || 'Gemini Flash'}</span>
          </div>
        )}
      </div>
    );
  }

  // Render markdown text lines
  const lines = answer.split('\n');

  return (
    <div className="space-y-4">
      {/* Formatted Text Body */}
      <div className="prose prose-zinc dark:prose-invert max-w-none text-sm leading-relaxed space-y-2">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={idx} className="h-1" />;

          // Headings
          if (trimmed.startsWith('### ')) {
            return (
              <h4 key={idx} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 pt-2 pb-0.5">
                {trimmed.replace('### ', '')}
              </h4>
            );
          }
          if (trimmed.startsWith('## ')) {
            return (
              <h3 key={idx} className="text-base font-semibold text-zinc-900 dark:text-zinc-100 pt-3 pb-1">
                {trimmed.replace('## ', '')}
              </h3>
            );
          }

          // Bullet points
          if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
            const content = trimmed.substring(2);
            return (
              <div key={idx} className="flex items-start gap-2 pl-2">
                <span className="text-zinc-400 mt-1 text-xs">•</span>
                <span className="flex-1">{renderWithBold(content)}</span>
              </div>
            );
          }

          // Horizontal rule
          if (trimmed === '---') {
            return <hr key={idx} className="border-zinc-200 dark:border-zinc-800 my-2" />;
          }

          // Disclaimer line styling
          if (trimmed === 'Information only, not legal advice.') {
            return (
              <div key={idx} className="pt-2 text-xs italic text-zinc-400 dark:text-zinc-500">
                {trimmed}
              </div>
            );
          }

          return <p key={idx} className="my-1">{renderWithBold(trimmed)}</p>;
        })}

        {/* Live typing indicator if streaming */}
        {isStreaming && (
          <span className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse ml-1 align-middle" />
        )}
      </div>

      {/* Verified Citation Chips */}
      {citations.length > 0 && (
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Verified Source Provisions ({citations.length}):</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {citations.map((c, i) => {
              const chunk = c.matchingChunkId ? chunkMap.get(c.matchingChunkId) : undefined;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => chunk && onCitationClick(c, chunk)}
                  disabled={!chunk}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all text-left ${
                    chunk
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 hover:shadow-xs cursor-pointer'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 cursor-default'
                  }`}
                  title={chunk ? `View source chunk (${chunk.document}, p.${c.page})` : 'Source chunk'}
                >
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">para {c.paragraph}</span>
                  <span className="text-zinc-400">•</span>
                  <span className="text-[11px] opacity-90 truncate max-w-[200px]">
                    p.{c.page} ({c.documentTitle.replace('RBI ', '')})
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">↗</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Unverified Warnings (if any) */}
      {unverifiedCitations.length > 0 && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-amber-600" />
          <span>Warning: {unverifiedCitations.length} cited provision(s) could not be verified in the retrieved excerpts.</span>
        </div>
      )}

      {/* Response time and model footer */}
      {timeTakenMs !== undefined && !isStreaming && (
        <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500 pt-1">
          <span className="flex items-center gap-1 font-mono">
            <Clock className="size-3" />
            {(timeTakenMs / 1000).toFixed(2)}s
          </span>
          <span>•</span>
          <span className="flex items-center gap-1 font-mono">
            <Sparkles className="size-3 text-emerald-500" />
            {modelUsed || 'gemini-3.8-flash'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Helper to render markdown **bold**
 */
function renderWithBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-zinc-900 dark:text-zinc-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
