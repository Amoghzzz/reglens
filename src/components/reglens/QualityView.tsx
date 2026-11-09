'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import s from './reglens.module.css';
import { cx } from './format';
import { SealIcon } from './icons';
import { Spinner } from './tools';

interface Summary {
  total: number;
  run: number;
  passed: number;
  correctPct: number | null;
  citationPct: number | null;
  refusalPct: number | null;
  supportedPct: number | null;
  claims: number;
  medianSec: number | null;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
}

interface Result {
  id: string;
  group: string;
  question: string;
  pass: boolean;
  correct: boolean | null;
  citedCorrectly: boolean | null;
  refusedCorrectly: boolean | null;
  missingFacts: string[];
  directionsCited: number;
  supported: number;
  partial: number;
  unsupported: number;
  timeMs: number;
  answer: string;
  error?: string;
}

const GROUP_LABEL: Record<string, string> = {
  direct: 'Direct questions',
  exception: 'Exceptions and cross-references',
  list: 'List questions (all Directions)',
  notfound: 'Not in the Directions',
  trap: 'Off-topic and trick questions',
};

function Mark({ v }: { v: boolean | null }) {
  if (v === null) return <span className={s.qNa}>n/a</span>;
  return <span className={v ? s.qYes : s.qNo}>{v ? 'Yes' : 'No'}</span>;
}

/** Evaluation results: how often RegLens is right, cites correctly, and refuses when it should. */
export default function QualityView() {
  const [data, setData] = useState<{ summary: Summary; results: Result[] } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/quality')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Could not load the evaluation results.'));
  }, []);

  const s1 = data?.summary;
  const metric = (label: string, value: number | null, help: string, suffix = '%') => (
    <div className={s.metric}>
      <p className={s.metricValue}>{value === null ? '–' : `${value}${suffix}`}</p>
      <p className={s.metricLabel}>{label}</p>
      <p className={s.metricHelp}>{help}</p>
    </div>
  );

  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <div className={s.topbarInner}>
          <Link href="/" className={s.wordmark}>
            <SealIcon className={s.wordmarkSeal} />
            RegLens
          </Link>
          <span className={s.badge}>Quality</span>
          <span className={s.spacer} />
          <Link href="/audit" className={s.newButton}>
            Audit log
          </Link>
        </div>
      </header>
      <main className={s.toolWide}>
        <h1 className={s.toolTitle}>How accurate is RegLens?</h1>
        <p className={s.toolLede}>
          RegLens is tested on {s1?.total ?? 'a set of'} questions with answers checked against the Direction text:
          direct questions, exceptions, list questions, questions the Directions don&apos;t cover, and trick questions.
          Scores are calculated in code from the answers, not judged by the AI.
        </p>

        {error && <p className={s.toolError}>{error}</p>}
        {!data && !error && (
          <div className={s.toolLoading}>
            <Spinner />
            <p>Loading results</p>
          </div>
        )}

        {data && s1 && s1.run === 0 && (
          <div className={s.toolEmpty}>
            <p className={s.toolEmptyTitle}>No evaluation has been run yet</p>
            <p>
              In a terminal in the project folder, run <code>npm run eval</code>. It asks each test question, scores the
              answers, and saves the results here. A full run uses about 90 AI requests and takes 10 to 20 minutes.
            </p>
          </div>
        )}

        {data && s1 && s1.run > 0 && (
          <>
            <div className={s.metrics}>
              {metric('Answers correct', s1.correctPct, 'Contains every expected fact')}
              {metric('Citations correct', s1.citationPct, 'Cites the right Direction and paragraph')}
              {metric('Correct refusals', s1.refusalPct, 'Declines off-topic and uncovered questions')}
              {metric('Claims supported', s1.supportedPct, `Of ${s1.claims} cited claims, per the claim check`)}
              {metric('Median answer time', s1.medianSec, 'Normal (non-list) questions', ' s')}
            </div>
            <p className={s.toolHeadMeta}>
              {s1.passed} of {s1.run} questions passed every check{s1.run < s1.total ? ` (${s1.total - s1.run} not run yet)` : ''}.
              {s1.startedAt ? ` Run started ${new Date(s1.startedAt).toLocaleString('en-IN')}` : ''}
              {s1.model ? ` with ${s1.model}.` : '.'}
            </p>

            {Object.keys(GROUP_LABEL).map((g) => {
              const rows = data.results.filter((r) => r.group === g);
              if (!rows.length) return null;
              return (
                <section key={g} className={s.qGroup}>
                  <h2 className={s.calTitle}>
                    {GROUP_LABEL[g]}{' '}
                    <span className={s.calCount}>
                      {rows.filter((r) => r.pass).length}/{rows.length}
                    </span>
                  </h2>
                  <div className={s.qTable} role="table">
                    <div className={cx(s.qRow, s.qHead)} role="row">
                      <span role="columnheader">Question</span>
                      <span role="columnheader">Correct</span>
                      <span role="columnheader">Cited</span>
                      <span role="columnheader">Refused</span>
                      <span role="columnheader">Time</span>
                    </div>
                    {rows.map((r) => (
                      <div key={r.id} className={s.qRowWrap}>
                        <button type="button" className={cx(s.qRow, !r.pass && s.qRowFail)} role="row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          <span className={s.qQuestion}>
                            <span className={r.pass ? s.qPass : s.qFail}>{r.pass ? 'Pass' : r.error ? 'Error' : 'Fail'}</span>
                            {r.question}
                          </span>
                          <Mark v={r.correct} />
                          <Mark v={r.citedCorrectly} />
                          <Mark v={r.refusedCorrectly} />
                          <span className={s.qTime}>{r.timeMs ? `${(r.timeMs / 1000).toFixed(1)} s` : '–'}</span>
                        </button>
                        {open === r.id && (
                          <div className={s.qDetail}>
                            {r.error && <p className={s.toolError}>{r.error}</p>}
                            {r.missingFacts.length > 0 && <p className={s.gapNote}>Missing: {r.missingFacts.join('; ')}</p>}
                            <p className={s.qMeta}>
                              Cites {r.directionsCited} Direction{r.directionsCited === 1 ? '' : 's'}. Claim check: {r.supported} supported,{' '}
                              {r.partial} partly, {r.unsupported} not supported.
                            </p>
                            <pre className={s.qAnswer}>{r.answer}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
