'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import s from './reglens.module.css';
import { cx, formatDate } from './format';
import { SealIcon } from './icons';
import { Spinner, downloadCsv } from './tools';

interface Entry {
  id?: string;
  at: string;
  kind?: string;
  question?: string;
  standaloneQuestion?: string;
  profile?: { type: string; layer: string; deposits: string };
  followUp?: boolean;
  searchMode?: string;
  answer?: string;
  notFoundReason?: string;
  citations?: { title: string; para: string; page: string }[];
  unverifiedCitations?: { title: string; para: string }[];
  support?: { title: string; para: string; verdict: string; reason: string }[];
  directionVersions?: { document: string; date: string }[];
  model?: string;
  timeMs?: number;
  cached?: boolean;
  error?: string;
  document?: string;
  summary?: { covered: number; partial: number; missing: number };
  feedback: { rating: string; note?: string; at: string }[];
}

function profileText(p?: Entry['profile']) {
  if (!p) return '';
  return [p.type !== 'any' ? p.type.toUpperCase() : '', p.layer !== 'any' ? `${p.layer} layer` : '', p.deposits === 'yes' ? 'deposit-taking' : p.deposits === 'no' ? 'non-deposit' : '']
    .filter(Boolean)
    .join(', ');
}

/** The audit trail: every question, the answer given, its sources and their versions, and any feedback. */
export default function AuditView() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'issues'>('all');

  useEffect(() => {
    fetch('/api/audit')
      .then((r) => r.json())
      .then((d) => setEntries(d.entries))
      .catch(() => setEntries([]));
  }, []);

  const shown = (entries ?? []).filter((e) => {
    if (filter === 'flagged') return e.feedback.some((f) => f.rating === 'flag' || f.rating === 'down');
    if (filter === 'issues') return (e.unverifiedCitations?.length ?? 0) > 0 || e.support?.some((x) => x.verdict !== 'supported') || !!e.error;
    return true;
  });

  const exportCsv = () =>
    downloadCsv(
      'RegLens audit log.csv',
      ['Time', 'Type', 'Question', 'Profile', 'Answer', 'Citations', 'Unverified', 'Claims not fully supported', 'Direction versions', 'Feedback', 'Model', 'Seconds'],
      shown.map((e) => [
        e.at,
        e.kind ?? 'question',
        e.question ?? e.document ?? '',
        profileText(e.profile),
        (e.answer ?? (e.summary ? `${e.summary.covered} covered, ${e.summary.partial} partial, ${e.summary.missing} missing` : '')).replace(/\s+/g, ' '),
        (e.citations ?? []).map((c) => `${c.title} para ${c.para}`).join('; '),
        (e.unverifiedCitations ?? []).map((c) => `${c.title} para ${c.para}`).join('; '),
        (e.support ?? []).filter((x) => x.verdict !== 'supported').map((x) => `${x.title} para ${x.para}: ${x.verdict}`).join('; '),
        (e.directionVersions ?? []).map((d) => `${d.document} (${d.date})`).join('; '),
        e.feedback.map((f) => `${f.rating}${f.note ? `: ${f.note}` : ''}`).join('; '),
        e.model ?? '',
        e.timeMs ? (e.timeMs / 1000).toFixed(1) : '',
      ]),
    );

  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <div className={s.topbarInner}>
          <Link href="/" className={s.wordmark}>
            <SealIcon className={s.wordmarkSeal} />
            RegLens
          </Link>
          <span className={s.badge}>Audit log</span>
          <span className={s.spacer} />
          <Link href="/quality" className={s.newButton}>
            Quality
          </Link>
        </div>
      </header>
      <main className={s.toolWide}>
        <div className={s.toolHeadWide}>
          <div>
            <h1 className={s.toolTitle}>Audit log</h1>
            <p className={s.toolLede}>
              Every question asked, the answer given, the exact Direction versions it relied on, citation and claim
              checks, and user feedback. Kept on this server, newest first.
            </p>
          </div>
          {shown.length > 0 && (
            <button type="button" className={s.actionButton} onClick={exportCsv}>
              Download as spreadsheet
            </button>
          )}
        </div>

        <div className={s.filterRow}>
          {(['all', 'flagged', 'issues'] as const).map((f) => (
            <button key={f} type="button" className={cx(s.filterChip, filter === f && s.filterChipActive)} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Everything' : f === 'flagged' ? 'Flagged or unhelpful' : 'Citation or claim issues'}
            </button>
          ))}
        </div>

        {!entries && (
          <div className={s.toolLoading}>
            <Spinner />
            <p>Loading the log</p>
          </div>
        )}
        {entries && !shown.length && <p className={s.toolEmptyNote}>Nothing here yet.</p>}

        <ul className={s.auditList}>
          {shown.map((e, i) => {
            const issues = (e.unverifiedCitations?.length ?? 0) + (e.support?.filter((x) => x.verdict !== 'supported').length ?? 0);
            return (
              <li key={`${e.at}-${i}`} className={s.auditItem}>
                <button type="button" className={s.auditHead} onClick={() => setOpen(open === i ? null : i)}>
                  <span className={s.auditTime}>
                    {formatDate(e.at.slice(0, 10))}, {e.at.slice(11, 16)}
                  </span>
                  <span className={s.auditQ}>{e.kind === 'gap-check' ? `Policy check: ${e.document}` : e.question}</span>
                  <span className={s.auditTags}>
                    {e.followUp && <span className={s.metaTag}>Follow-up</span>}
                    {profileText(e.profile) && <span className={s.metaTag}>{profileText(e.profile)}</span>}
                    {e.notFoundReason && <span className={s.metaTag}>Not answered</span>}
                    {e.cached && <span className={s.metaTag}>Saved answer</span>}
                    {issues > 0 && <span className={cx(s.appliesTag, s.appliesMaybe)}>{issues} to review</span>}
                    {e.feedback.map((f, k) => (
                      <span key={k} className={cx(s.appliesTag, f.rating === 'up' ? s.appliesYes : s.appliesMaybe)}>
                        {f.rating === 'up' ? 'Helpful' : f.rating === 'down' ? 'Not helpful' : 'Flagged'}
                      </span>
                    ))}
                    {e.error && <span className={cx(s.appliesTag, s.appliesMaybe)}>Error</span>}
                  </span>
                </button>
                {open === i && (
                  <div className={s.qDetail}>
                    {e.standaloneQuestion && e.standaloneQuestion !== e.question && <p className={s.qMeta}>Read as: {e.standaloneQuestion}</p>}
                    {e.feedback.filter((f) => f.note).map((f, k) => (
                      <p key={k} className={s.gapNote}>Feedback: {f.note}</p>
                    ))}
                    {e.answer && <pre className={s.qAnswer}>{e.answer}</pre>}
                    {e.summary && (
                      <p className={s.qMeta}>
                        {e.summary.covered} covered, {e.summary.partial} partly covered, {e.summary.missing} missing
                      </p>
                    )}
                    {!!e.support?.filter((x) => x.verdict !== 'supported').length && (
                      <ul className={s.auditIssues}>
                        {e.support.filter((x) => x.verdict !== 'supported').map((x, k) => (
                          <li key={k}>
                            {x.title}, para {x.para}: {x.verdict === 'partial' ? 'partly supported' : 'not supported'}
                            {x.reason ? ` (${x.reason})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!!e.directionVersions?.length && (
                      <p className={s.qMeta}>
                        Direction versions used: {e.directionVersions.map((d) => `${d.document.replace(/^RBI_|\.pdf$/g, '').replace(/_/g, ' ')}`).join('; ')}
                      </p>
                    )}
                    <p className={s.qMeta}>
                      {e.model ? `Model ${e.model}. ` : ''}
                      {e.timeMs ? `${(e.timeMs / 1000).toFixed(1)} s.` : ''} {e.id ? `Answer id ${e.id}.` : ''}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
