'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from './reglens.module.css';
import type { ChunkView, PanelState } from './types';
import type { Obligation } from '../../lib/obligationTypes';
import { appliesToProfile } from '../../lib/obligationTypes';
import { isProfileSet, type Profile } from '../../lib/profile';
import { cx } from './format';
import { AppliesChip, CiteChip, Spinner, downloadCsv, openSource, timingText } from './tools';

type CalItem = Obligation & { document: string; title: string; entity: string; date: string };

interface CalendarData {
  items: CalItem[];
  chunks: Record<string, ChunkView>;
  built: number;
  total: number;
  missing: { document: string; shortTitle: string }[];
}

const GROUPS: { id: string; title: string; help: string; match: (o: CalItem) => boolean }[] = [
  { id: 'monthly', title: 'Every month', help: 'Recurring monthly returns and reviews', match: (o) => o.timing.kind === 'periodic' && o.timing.frequency === 'monthly' },
  { id: 'quarterly', title: 'Every quarter', help: 'Quarterly returns, reviews and reports', match: (o) => o.timing.kind === 'periodic' && o.timing.frequency === 'quarterly' },
  { id: 'half', title: 'Every six months', help: 'Half-yearly requirements', match: (o) => o.timing.kind === 'periodic' && o.timing.frequency === 'half-yearly' },
  { id: 'annual', title: 'Every year', help: 'Annual reviews, filings and certificates', match: (o) => o.timing.kind === 'periodic' && (o.timing.frequency === 'annual' || !o.timing.frequency) },
  { id: 'deadline', title: 'Fixed deadlines', help: 'Due by a set date or within a set time', match: (o) => o.timing.kind === 'deadline' },
  { id: 'event', title: 'When something happens', help: 'Clocks that start when an event occurs, such as a change in directors', match: (o) => o.timing.kind === 'event' },
];

function short(title: string) {
  return title.replace(/^RBI\s+/i, '').replace(/\s+Directions\b.*$/i, '');
}

/** Every dated obligation across the Directions, grouped by how often or when it falls due. */
export default function CalendarView({ profile, onOpen }: { profile: Profile; onOpen: (p: PanelState) => void }) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState('');
  const [building, setBuilding] = useState<{ done: number; total: number; current: string } | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not load the calendar.');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the calendar.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buildAll = async () => {
    if (!data) return;
    stopRef.current = false;
    const todo = [...data.missing];
    setError('');
    for (let i = 0; i < todo.length; i++) {
      if (stopRef.current) break;
      setBuilding({ done: i, total: todo.length, current: todo[i].shortTitle });
      try {
        const res = await fetch('/api/checklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: todo[i].document }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `Could not read ${todo[i].shortTitle}.`);
        }
      } catch (err) {
        setError(`${err instanceof Error ? err.message : 'Something went wrong.'} Building paused; press the button to continue.`);
        break;
      }
      await load();
    }
    setBuilding(null);
    await load();
  };

  const profileSet = isProfileSet(profile);
  const items = useMemo(
    () => (data?.items ?? []).filter((o) => !profileSet || !onlyMine || appliesToProfile(o, o.document, profile) !== 'no'),
    [data, onlyMine, profile, profileSet],
  );

  return (
    <main className={s.toolWide}>
      <header className={s.toolHeadWide}>
        <div>
          <h1 className={s.toolTitle}>Compliance calendar</h1>
          <p className={s.toolLede}>
            Every recurring return, review and time-limited duty across the Directions, grouped by when it falls due.
          </p>
        </div>
        {data && data.items.length > 0 && (
          <button
            type="button"
            className={s.actionButton}
            onClick={() =>
              downloadCsv(
                'RegLens compliance calendar.csv',
                ['When', 'Obligation', 'Detail', 'Direction', 'Applies to', 'Paragraph', 'Page'],
                items.map((o) => [timingText(o), o.obligation, o.detail, short(o.title), o.appliesTo, o.para, o.page]),
              )
            }
          >
            Download as spreadsheet
          </button>
        )}
      </header>

      {error && <p className={s.toolError}>{error}</p>}
      {!data && !error && (
        <div className={s.toolLoading}>
          <Spinner />
          <p>Loading the calendar</p>
        </div>
      )}

      {data && data.built < data.total && (
        <div className={s.buildBanner}>
          <div className={s.buildText}>
            <p className={s.buildTitle}>
              Built from {data.built} of {data.total} Directions
            </p>
            {building ? (
              <>
                <p>
                  Reading {building.current} ({building.done + 1} of {building.total}). Each Direction takes about a
                  minute; you can keep using RegLens in another tab.
                </p>
                <div className={s.buildBar}>
                  <span style={{ width: `${Math.round((building.done / building.total) * 100)}%` }} />
                </div>
              </>
            ) : (
              <p>
                RegLens needs to read each Direction once to find its deadlines. Reading the remaining{' '}
                {data.total - data.built} takes roughly {Math.max(1, Math.round((data.total - data.built) * 0.9))} minutes, and
                the results are saved.
              </p>
            )}
          </div>
          {building ? (
            <button type="button" className={s.actionButton} onClick={() => (stopRef.current = true)}>
              Pause
            </button>
          ) : (
            <button type="button" className={s.primaryButton} onClick={() => void buildAll()}>
              {data.built ? 'Read the rest' : 'Build the calendar'}
            </button>
          )}
        </div>
      )}

      {data && profileSet && (
        <label className={cx(s.toggle, s.toggleStandalone)}>
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Only what applies to me
        </label>
      )}

      {data && (
        <div className={s.calGrid}>
          {GROUPS.map((g) => {
            const list = items.filter(g.match);
            if (!list.length) return null;
            return (
              <section key={g.id} className={s.calGroup}>
                <h2 className={s.calTitle}>
                  {g.title} <span className={s.calCount}>{list.length}</span>
                </h2>
                <p className={s.calHelp}>{g.help}</p>
                <ul className={s.calList}>
                  {list.map((o) => (
                    <li key={o.id} className={s.calItem}>
                      {timingText(o) && <p className={s.calWhen}>{timingText(o)}</p>}
                      <p className={s.calText}>{o.obligation}</p>
                      <div className={s.obligationMeta}>
                        <span className={s.metaTag}>{short(o.title)}</span>
                        <AppliesChip item={o} document={o.document} profile={profile} />
                        <CiteChip item={o} onClick={o.chunkId ? () => openSource(onOpen, data.chunks, o) : undefined} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {data.built > 0 && !items.length && <p className={s.toolEmptyNote}>No dated obligations found yet.</p>}
        </div>
      )}
      <p className={s.disclaimer}>
        Extracted by AI from each Direction and checked against its paragraphs. Confirm dates in the original before
        relying on them. Information only, not legal advice.
      </p>
    </main>
  );
}
