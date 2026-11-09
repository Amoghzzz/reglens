'use client';

import { useEffect, useRef, useState } from 'react';
import s from './reglens.module.css';
import type { PanelState } from './types';
import { classifyLine, cx, docTitleOf, formatDate, markLines, pageLabel, pageSuffix, paraRange } from './format';
import { CloseIcon, CopyIcon } from './icons';

interface Props {
  state: PanelState | null;
  onClose: () => void;
}

export default function SourcePanel({ state, onClose }: Props) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  // Close on Escape, and move focus into the panel when it opens.
  useEffect(() => {
    if (!state) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  // Bring the cited paragraph into view.
  useEffect(() => {
    if (!state) return;
    setCopied(false);
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' });
    } else {
      bodyRef.current?.scrollTo({ top: 0 });
    }
  }, [state]);

  if (!state) return null;

  const { result, paragraph } = state;
  const chunk = result.chunk;
  const title = docTitleOf(chunk);
  const lines = markLines(chunk.text, paragraph);
  const firstHighlight = lines.findIndex((l) => l.hl);
  const citationText = `${title}${paragraph ? `, para ${paragraph}` : ''}${pageSuffix(chunk.pageRange)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(citationText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={s.panel} role="dialog" aria-modal="false" aria-labelledby="source-title">
        <header className={s.panelHead}>
          <div className={s.panelTop}>
            <h2 id="source-title" className={s.panelTitle}>
              {title}
            </h2>
            <button ref={closeRef} type="button" className={s.iconButton} onClick={onClose} aria-label="Close source">
              <CloseIcon />
            </button>
          </div>
          {chunk.chapter && <p className={s.panelChapter}>{chunk.chapter}</p>}

          <dl className={s.facts}>
            {paragraph && (
              <div className={s.fact}>
                <dt>Cited paragraph</dt>
                <dd>{paragraph}</dd>
              </div>
            )}
            {!paragraph && paraRange(chunk) && (
              <div className={s.fact}>
                <dt>Covers</dt>
                <dd>{paraRange(chunk)}</dd>
              </div>
            )}
            <div className={s.fact}>
              <dt>{chunk.pageRange === 'web' ? 'Source' : 'Page'}</dt>
              <dd>
                {chunk.pageRange === 'web' && chunk.sourceUrl ? (
                  <a href={chunk.sourceUrl} target="_blank" rel="noreferrer">
                    RBI web page
                  </a>
                ) : (
                  pageLabel(chunk.pageRange)
                )}
              </dd>
            </div>
            {chunk.date && (
              <div className={s.fact}>
                <dt>Version</dt>
                <dd>Updated {formatDate(chunk.date)}</dd>
              </div>
            )}
          </dl>

          <div className={s.panelActions}>
            <button type="button" className={cx(s.copyButton, copied && s.copyDone)} onClick={copy}>
              <CopyIcon />
              {copied ? 'Citation copied' : 'Copy citation'}
            </button>
          </div>
        </header>

        <div ref={bodyRef} className={s.panelBody}>
          {lines.map((l, i) => {
            const c = classifyLine(l.line);
            if (!c.body) return null;
            return (
              <div
                key={i}
                ref={i === firstHighlight ? highlightRef : undefined}
                className={cx(
                  s.srcLine,
                  c.kind === 'heading' && s.srcHeading,
                  c.kind === 'para' && s.srcPara,
                  c.kind === 'sub' && s.srcSub,
                  c.kind === 'footnote' && s.srcFootnote,
                  l.hl && s.srcHl,
                )}
              >
                <span className={s.srcNum}>{c.num ?? ''}</span>
                <span className={s.srcBody}>{c.body}</span>
              </div>
            );
          })}
        </div>

        <footer className={s.panelFoot}>
          Text extracted from the official RBI PDF. Check the original Direction before acting on it.
        </footer>
      </aside>
    </>
  );
}
