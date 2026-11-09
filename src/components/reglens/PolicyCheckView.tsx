'use client';

import { useMemo, useRef, useState } from 'react';
import s from './reglens.module.css';
import type { ChunkView, PanelState } from './types';
import type { Obligation } from '../../lib/obligationTypes';
import { isProfileSet, shortProfile, type Profile } from '../../lib/profile';
import { cx } from './format';
import { CiteChip, Spinner, TYPE_ENTITY_LABEL, downloadCsv, openSource, useDirections } from './tools';

interface GapResult {
  obligation: Obligation;
  applies: 'yes' | 'no' | 'depends';
  status: 'covered' | 'partial' | 'missing';
  evidence: string;
  note: string;
}

interface GapResponse {
  title: string;
  date: string;
  results: GapResult[];
  truncated: boolean;
  skipped: number;
  chunks: Record<string, ChunkView>;
}

const STATUS_LABEL = { covered: 'Covered', partial: 'Partly covered', missing: 'Missing' } as const;

/** Paste or upload an internal policy and see which of a Direction's requirements it covers. */
export default function PolicyCheckView({ profile, onOpen }: { profile: Profile; onOpen: (p: PanelState) => void }) {
  const { directions } = useDirections();
  const [document, setDocument] = useState('');
  const [policy, setPolicy] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GapResponse | null>(null);
  const [show, setShow] = useState<'all' | 'gaps'>('gaps');
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setFileName(file.name);
    if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith('text/')) {
      setPolicy(await file.text());
      return;
    }
    if (!/\.pdf$/i.test(file.name)) {
      setError('Upload a PDF or a text file, or paste the policy text. For Word files, save as PDF first.');
      return;
    }
    setReading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/extract-text', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read that file.');
      setPolicy(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setReading(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/gap-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, policy, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not run the check.');
      setResult(data);
      setShow('gaps');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the check.');
    } finally {
      setRunning(false);
    }
  };

  const counts = useMemo(() => {
    const c = { covered: 0, partial: 0, missing: 0 };
    result?.results.forEach((r) => c[r.status]++);
    return c;
  }, [result]);
  const total = result?.results.length ?? 0;
  const shown = (result?.results ?? []).filter((r) => show === 'all' || r.status !== 'covered');
  const chosen = directions.find((d) => d.document === document);

  return (
    <main className={s.toolWide}>
      <header className={s.toolHeadWide}>
        <div>
          <h1 className={s.toolTitle}>Policy check</h1>
          <p className={s.toolLede}>
            Compare your internal policy with an RBI Direction. RegLens checks each requirement and shows what&apos;s
            covered, what&apos;s partly covered and what&apos;s missing, quoting your policy as evidence.
          </p>
        </div>
      </header>

      <div className={s.gapForm}>
        <label className={s.field}>
          <span className={s.fieldLabel}>1. Which Direction should the policy follow?</span>
          <select className={s.select} value={document} onChange={(e) => setDocument(e.target.value)}>
            <option value="">Choose a Direction</option>
            {directions.map((d) => (
              <option key={d.document} value={d.document}>
                {d.entity === 'NBFC' ? d.shortTitle : TYPE_ENTITY_LABEL[d.entity] ?? d.shortTitle}
                {d.hasChecklist ? '' : ' (first check takes longer)'}
              </option>
            ))}
          </select>
        </label>

        <div className={s.field}>
          <span className={s.fieldLabel}>2. Paste the policy, or upload it as a PDF or text file</span>
          <textarea
            className={s.policyInput}
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            placeholder="Paste your KYC, outsourcing or other policy here"
            rows={10}
          />
          <div className={s.uploadRow}>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain"
              className={s.srOnly}
              onChange={(e) => void onFile(e.target.files?.[0])}
              id="policy-file"
            />
            <button type="button" className={s.actionButton} onClick={() => fileRef.current?.click()} disabled={reading}>
              {reading ? 'Reading file' : 'Upload a file'}
            </button>
            <span className={s.uploadNote}>
              {fileName ? `${fileName}, ` : ''}
              {policy ? `${policy.length.toLocaleString('en-IN')} characters` : 'PDF or text, up to 15 MB'}
            </span>
          </div>
          <p className={s.privacyNote}>
            Your policy text is sent to Google&apos;s Gemini AI to run the comparison. Don&apos;t upload confidential
            documents to this demo.
          </p>
        </div>

        <div className={s.gapRun}>
          <button
            type="button"
            className={s.primaryButton}
            onClick={() => void run()}
            disabled={!document || policy.trim().length < 200 || running}
          >
            {running ? 'Checking' : 'Check my policy'}
          </button>
          {isProfileSet(profile) && <span className={s.uploadNote}>Requirements filtered for: {shortProfile(profile)}</span>}
        </div>
      </div>

      {error && <p className={s.toolError}>{error}</p>}
      {running && (
        <div className={s.toolLoading}>
          <Spinner />
          <div>
            <p className={s.toolLoadingTitle}>Comparing your policy with {chosen?.shortTitle ?? 'the Direction'}</p>
            <p>
              {chosen?.hasChecklist
                ? 'This takes about 30 seconds.'
                : 'RegLens first reads the whole Direction to list its requirements, so this one takes 1 to 2 minutes.'}
            </p>
          </div>
        </div>
      )}

      {result && (
        <section className={s.gapResults}>
          <h2 className={s.toolHeadTitle}>{result.title}</h2>
          <div className={s.gapSummary}>
            <div className={s.gapBar} aria-hidden="true">
              <span className={s.gapCovered} style={{ flex: counts.covered }} />
              <span className={s.gapPartial} style={{ flex: counts.partial }} />
              <span className={s.gapMissing} style={{ flex: counts.missing }} />
            </div>
            <p className={s.gapCounts}>
              <strong>{counts.covered}</strong> covered, <strong>{counts.partial}</strong> partly covered,{' '}
              <strong>{counts.missing}</strong> missing, out of {total} requirements
              {result.skipped ? ` (${result.skipped} that don't apply to your NBFC were left out)` : ''}.
            </p>
            {result.truncated && (
              <p className={s.actionHint}>The policy was long, so only the first part was checked.</p>
            )}
          </div>

          <div className={s.filterRow}>
            <button type="button" className={cx(s.filterChip, show === 'gaps' && s.filterChipActive)} onClick={() => setShow('gaps')}>
              Gaps only ({counts.partial + counts.missing})
            </button>
            <button type="button" className={cx(s.filterChip, show === 'all' && s.filterChipActive)} onClick={() => setShow('all')}>
              Everything ({total})
            </button>
            <button
              type="button"
              className={s.actionButton}
              onClick={() =>
                downloadCsv(
                  `RegLens policy check - ${result.title}.csv`,
                  ['Status', 'Requirement', 'Detail', 'What to add', 'Evidence from policy', 'Paragraph', 'Page'],
                  result.results.map((r) => [
                    STATUS_LABEL[r.status],
                    r.obligation.obligation,
                    r.obligation.detail,
                    r.note,
                    r.evidence,
                    r.obligation.para,
                    r.obligation.page,
                  ]),
                )
              }
            >
              Download as spreadsheet
            </button>
          </div>

          <ul className={s.obligations}>
            {shown.map((r) => (
              <li key={r.obligation.id} className={cx(s.gapItem, s[`gap_${r.status}`])}>
                <span className={cx(s.gapStatus, s[`gapStatus_${r.status}`])}>{STATUS_LABEL[r.status]}</span>
                <div className={s.obligationBody}>
                  <p className={s.obligationText}>{r.obligation.obligation}</p>
                  {r.obligation.detail && <p className={s.obligationDetail}>{r.obligation.detail}</p>}
                  {r.note && r.status !== 'covered' && <p className={s.gapNote}>{r.note}</p>}
                  {r.evidence && <blockquote className={s.gapEvidence}>{r.evidence}</blockquote>}
                  <div className={s.obligationMeta}>
                    {r.applies === 'depends' && <span className={cx(s.appliesTag, s.appliesMaybe)}>May apply</span>}
                    <CiteChip
                      item={r.obligation}
                      onClick={r.obligation.chunkId ? () => openSource(onOpen, result.chunks, r.obligation) : undefined}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className={s.disclaimer}>
            AI-assisted comparison. Quotes are checked against your text; treat results as a review aid, not an audit
            opinion. Information only, not legal advice.
          </p>
        </section>
      )}
    </main>
  );
}
