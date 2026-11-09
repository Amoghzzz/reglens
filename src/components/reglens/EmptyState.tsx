'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import s from './reglens.module.css';
import { CORE_DIRECTIONS, EXAMPLES, TOPICS, TYPE_DIRECTIONS } from './directions';
import { cx } from './format';
import { ArrowIcon, BookIcon, ChevronIcon, SealIcon, ShieldIcon } from './icons';
import UpdateCheck from './UpdateCheck';

interface Props {
  input: string;
  setInput: (v: string) => void;
  onAsk: (q: string) => void;
  busy: boolean;
}

export default function EmptyState({ input, setInput, onAsk, busy }: Props) {
  const [showCoverage, setShowCoverage] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAsk(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onAsk(input);
    }
  };

  return (
    <div className={s.hero}>
      <div className={s.heroInner}>
        <h1 className={s.heroTitle}>Ask anything about RBI rules for NBFCs</h1>
        <p className={s.heroLede}>
          Plain-English answers from the RBI&apos;s Master Directions, with every claim linked to the exact paragraph
          it came from.
        </p>

        <form className={s.searchBox} onSubmit={submit}>
          <label htmlFor="hero-question" className={s.srOnly}>
            Your question
          </label>
          <textarea
            id="hero-question"
            className={s.searchInput}
            rows={2}
            maxLength={500}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="When does a loan become an NPA?"
            autoFocus
          />
          <div className={s.searchBar}>
            <span className={s.searchHint}>Press Enter to ask</span>
            <button type="submit" className={s.sendButton} disabled={busy || !input.trim()} aria-label="Ask">
              <ArrowIcon />
            </button>
          </div>
        </form>

        <div className={s.topics} aria-label="Popular topics">
          {TOPICS.map((t) => (
            <button key={t.label} type="button" className={s.topic} onClick={() => onAsk(t.question)} disabled={busy}>
              {t.label}
            </button>
          ))}
        </div>

        <div className={s.examplesGrid}>
          {EXAMPLES.map((ex, i) => (
            <button key={ex} type="button" className={s.exampleCard} onClick={() => onAsk(ex)} disabled={busy}>
              <span className={s.exampleText}>{ex}</span>
              {i === EXAMPLES.length - 1 && <span className={s.exampleTag}>Not covered: see how it says so</span>}
            </button>
          ))}
        </div>

        <ul className={s.trust}>
          <li>
            <BookIcon className={s.trustIcon} />
            Answers only from official RBI text
          </li>
          <li>
            <SealIcon className={s.trustIcon} />
            Every citation checked before you see it
          </li>
          <li>
            <ShieldIcon className={s.trustIcon} />
            Says so when the answer isn&apos;t there
          </li>
        </ul>

        <section className={s.coverage}>
          <button
            type="button"
            className={s.coverageToggle}
            onClick={() => setShowCoverage((v) => !v)}
            aria-expanded={showCoverage}
          >
            <span>
              <strong>35 Master Directions</strong> for NBFCs, 1,327 pages, current to October 2026
            </span>
            <span className={s.coverageAction}>
              {showCoverage ? 'Hide list' : 'See all'}
              <ChevronIcon className={cx(s.coverageChevron, showCoverage && s.coverageChevronOpen)} />
            </span>
          </button>
          {showCoverage && (
            <div className={s.coverageBody}>
              <div>
                <h2 className={s.coverageGroup}>Rules for all NBFCs</h2>
                <ul className={s.coverageList}>
                  {CORE_DIRECTIONS.map((d) => (
                    <li key={d.name} className={s.coverageItem}>
                      <span>{d.name}</span>
                      <span className={s.coverageDate}>{d.updated}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className={s.coverageGroup}>Specific types of NBFC</h2>
                <ul className={s.coverageList}>
                  {TYPE_DIRECTIONS.map((d) => (
                    <li key={d.name} className={s.coverageItem}>
                      <span>{d.name}</span>
                      <span className={s.coverageDate}>{d.updated}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <UpdateCheck />
            </div>
          )}
        </section>

        <p className={s.heroNote}>
          Information only, not legal advice. <Link href="/quality">How accurate is RegLens?</Link>{' '}
          <Link href="/audit">Audit log</Link>
        </p>
      </div>
    </div>
  );
}
