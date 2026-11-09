'use client';

import React, { useEffect } from 'react';
import { X, BookOpen, Calendar, FileText, ExternalLink, CheckCircle2, Layers } from 'lucide-react';
import { Citation } from '@/lib/qa';
import { ChunkMetadata } from '@/lib/search';

interface SourceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  citation: Citation | null;
  chunk: ChunkMetadata | null;
}

export function SourceDrawer({ isOpen, onClose, citation, chunk }: SourceDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !chunk) return null;

  // Extract base paragraph number for highlighting
  const citedPara = citation?.paragraph || '';
  const baseParaMatch = citedPara.match(/^([0-9]+[A-Za-z]?)/);
  const basePara = baseParaMatch ? baseParaMatch[1] : citedPara;

  // Split text into paragraphs/sections to highlight the cited one
  const lines = chunk.text.split('\n\n');

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <div className="relative z-50 flex h-full w-full max-w-xl flex-col bg-white dark:bg-zinc-900 shadow-2xl transition-transform duration-300 ease-in-out border-l border-zinc-200 dark:border-zinc-800">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-200 dark:border-zinc-800 p-5 pb-4 bg-zinc-50 dark:bg-zinc-950/60">
          <div className="space-y-1 pr-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="size-3" />
                Verified RBI Source
              </span>
              <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                Chunk #{chunk.id.split('_').pop()}
              </span>
            </div>
            <h2 className="text-base font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
              {chunk.document.replace('.pdf', '')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            title="Close source panel"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Metadata Badges */}
        <div className="grid grid-cols-2 gap-2 p-4 text-xs bg-zinc-100/60 dark:bg-zinc-900/40 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <BookOpen className="size-3.5 text-indigo-500 shrink-0" />
            <span>Pages: <strong>{chunk.pageRange}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <Calendar className="size-3.5 text-blue-500 shrink-0" />
            <span>Date: <strong>{chunk.date}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <FileText className="size-3.5 text-amber-500 shrink-0" />
            <span>Target Para: <strong className="text-amber-700 dark:text-amber-400 font-mono">para {citedPara}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <Layers className="size-3.5 text-emerald-500 shrink-0" />
            <span>Entity: <strong>{chunk.entity}</strong></span>
          </div>
        </div>

        {/* Breadcrumb Context */}
        {chunk.contextLine && (
          <div className="px-5 py-2.5 bg-zinc-50 dark:bg-zinc-950/40 border-b border-zinc-100 dark:border-zinc-800/80 text-xs text-zinc-500 dark:text-zinc-400 font-mono leading-relaxed">
            {chunk.contextLine}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-1">
            Exact Direction Text
          </div>

          {lines.map((paraBlock, idx) => {
            // Check if this block contains the cited paragraph number
            const isTarget =
              (basePara && (
                paraBlock.trim().startsWith(`${basePara}.`) ||
                paraBlock.includes(` ${basePara}. `) ||
                paraBlock.startsWith(`${basePara} `) ||
                (paraBlock.includes(`(${basePara})`) && citedPara.includes(`(${basePara})`))
              )) ||
              (citedPara && paraBlock.includes(citedPara));

            const isFootnote = paraBlock.trim().startsWith('[Footnote');

            if (isFootnote) {
              return (
                <div
                  key={idx}
                  className="rounded-md bg-zinc-100 dark:bg-zinc-800/60 p-3 text-xs text-zinc-600 dark:text-zinc-400 italic border border-zinc-200/80 dark:border-zinc-700/60"
                >
                  {paraBlock}
                </div>
              );
            }

            if (isTarget) {
              return (
                <div
                  key={idx}
                  className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-500 p-3.5 shadow-xs text-zinc-900 dark:text-amber-100 ring-1 ring-amber-200 dark:ring-amber-900/60"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400 mb-1.5 uppercase tracking-wide">
                    <span>★ Cited Provision (Para {citedPara})</span>
                  </div>
                  <div className="whitespace-pre-wrap">{paraBlock}</div>
                </div>
              );
            }

            return (
              <div key={idx} className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {paraBlock}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/80 flex items-center justify-between text-xs text-zinc-500">
          <span>RBI NBFC Master Directions Repository</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
