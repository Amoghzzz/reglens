'use client';

import { useEffect, useState } from 'react';
import s from './reglens.module.css';
import type { UpdateReport } from '../../lib/updates';
import { Spinner } from './tools';

function niceDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function niceTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "Is this still current?": compares the indexed Directions with the RBI website, on request. */
export default function UpdateCheck() {
  const [report, setReport] = useState<UpdateReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetch('/api/updates')
      .then((r) => r.json())
      .then((j) => j.report && setReport(j.report))
      .catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/updates?${report ? 'refresh' : 'check'}=1`);
      const j = await res.json();
      if (j.report) setReport(j.report);
      if (!j.report?.ok || j.report?.error) setError(j.report?.error || 'Could not check the RBI site.');
    } catch {
      setError('Could not check the RBI site.');
    } finally {
      setBusy(false);
    }
  };

  const newer = report?.rows.filter((r) => r.state === 'newer') ?? [];
  const check = report?.rows.filter((r) => r.state === 'check') ?? [];
  const missing = report?.rows.filter((r) => r.state === 'missing') ?? [];
  const current = report?.rows.filter((r) => r.state === 'current').length ?? 0;
  const extra = report?.notIndexed ?? [];

  return (
    <div className={s.updates}>
      <div className={s.updatesHead}>
        <div>
          <p className={s.updatesTitle}>Is this still current?</p>
          <p className={s.updatesText}>
            {report?.ok
              ? newer.length
                ? `${newer.length} of ${report.rows.length} Directions have a newer version on the RBI site. Answers from them may be out of date.`
                : check.length
                  ? `${current} of ${report.rows.length} Directions match the RBI site. ${check.length} are listed there under a later date; open them to see whether the text changed.`
                  : `All ${current} Directions match the latest version on the RBI site.`
              : 'Compare these versions with the RBI’s Master Directions page.'}
            {report?.ok && <span className={s.updatesWhen}> Checked {niceTime(report.checkedAt)}.</span>}
          </p>
        </div>
        <button type="button" className={s.actionButton} onClick={() => void run()} disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? 'Checking RBI…' : report?.ok ? 'Check again' : 'Check the RBI site'}
        </button>
      </div>

      {error && <p className={s.toolError}>{error}</p>}

      {newer.length > 0 && (
        <ul className={s.updatesList}>
          {newer.map((r) => (
            <li key={r.document} className={s.updatesItem}>
              <span className={s.updatesBadgeNew}>Newer on RBI</span>
              <span className={s.updatesName}>{r.shortTitle}</span>
              <span className={s.updatesDates}>
                RegLens has {niceDate(r.indexedDate)}, RBI has{' '}
                <a href={r.rbi!.url} target="_blank" rel="noreferrer">
                  {niceDate(r.rbi!.date)}
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {check.length > 0 && (
        <ul className={s.updatesList}>
          {check.map((r) => (
            <li key={r.document} className={s.updatesItem}>
              <span className={s.updatesBadgeCheck}>Check</span>
              <span className={s.updatesName}>{r.shortTitle}</span>
              <span className={s.updatesDates}>
                RegLens has {niceDate(r.indexedDate)}, RBI lists it under{' '}
                <a href={r.rbi!.url} target="_blank" rel="noreferrer">
                  {niceDate(r.rbi!.date)}
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && report?.ok && (
        <p className={s.updatesNote}>
          Could not find {missing.map((m) => m.shortTitle).join(', ')} on the RBI page. It may have been renamed or withdrawn;
          check it by hand.
        </p>
      )}

      {extra.length > 0 && (
        <div className={s.updatesNote}>
          <button type="button" className={s.linkButton} onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Hide' : 'Show'} {extra.length} NBFC Direction{extra.length === 1 ? '' : 's'} on the RBI site that RegLens
            does not cover
          </button>
          {showNew && (
            <ul className={s.updatesList}>
              {extra.map((e) => (
                <li key={e.id} className={s.updatesItem}>
                  <a className={s.updatesName} href={e.url} target="_blank" rel="noreferrer">
                    {e.subject || e.title}
                  </a>
                  <span className={s.updatesDates}>{niceDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
