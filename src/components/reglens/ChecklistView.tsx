'use client';

import { useEffect, useMemo, useState } from 'react';
import s from './reglens.module.css';
import type { ChunkView, PanelState } from './types';
import type { Category, Checklist } from '../../lib/obligationTypes';
import { appliesToProfile } from '../../lib/obligationTypes';
import { TYPE_OPTIONS, directionType, isProfileSet, shortProfile, type Profile } from '../../lib/profile';
import { cx } from './format';
import {
  AppliesChip,
  CiteChip,
  Spinner,
  downloadCsv,
  openSource,
  timingText,
  useDirections,
  versionText,
} from './tools';

const DONE_KEY = 'reglens.checklistDone';

function loadDone(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(DONE_KEY) || '{}');
  } catch {
    return {};
  }
}

interface Props {
  profile: Profile;
  onOpen: (p: PanelState) => void;
}

/** Pick a Direction and get a cited checklist of everything it requires. */
export default function ChecklistView({ profile, onOpen }: Props) {
  const { directions, error: listError, reload } = useDirections();
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [chunks, setChunks] = useState<Record<string, ChunkView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyMine, setOnlyMine] = useState(true);
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => setDone(loadDone()), []);

  const toggleDone = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        // progress still shows for this visit
      }
      return next;
    });
  };

  const load = async (document: string, refresh = false) => {
    setSelected(document);
    setLoading(true);
    setError('');
    setChecklist(null);
    setCategory('All');
    try {
      const res = await fetch('/api/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, refresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not build the checklist.');
      setChecklist(data.checklist);
      setChunks(data.chunks);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the checklist.');
    } finally {
      setLoading(false);
    }
  };

  const profileSet = isProfileSet(profile);
  const visible = useMemo(() => {
    if (!checklist) return [];
    return checklist.items.filter(
      (it) =>
        (category === 'All' || it.category === category) &&
        (!profileSet || !onlyMine || appliesToProfile(it, checklist.document, profile) !== 'no'),
    );
  }, [checklist, category, onlyMine, profile, profileSet]);

  const categories = useMemo(() => {
    if (!checklist) return [];
    const counts = new Map<string, number>();
    checklist.items.forEach((it) => counts.set(it.category, (counts.get(it.category) ?? 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [checklist]);

  const core = directions.filter((d) => !directionType(d.document));
  const typed = directions.filter((d) => directionType(d.document));
  const matches = (d: { shortTitle: string }) => d.shortTitle.toLowerCase().includes(filter.toLowerCase());
  const doneCount = visible.filter((it) => done[it.id]).length;
  const notForYou = checklist && profileSet ? checklist.items.filter((it) => appliesToProfile(it, checklist.document, profile) === 'no').length : 0;

  return (
    <main className={s.tool}>
      <aside className={s.toolSide}>
        <h1 className={s.toolTitle}>Checklists</h1>
        <p className={s.toolLede}>Pick a Direction to get a checklist of everything it requires, each item cited.</p>
        <input
          className={s.toolSearch}
          placeholder="Filter Directions"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter Directions"
        />
        {listError && <p className={s.toolError}>{listError}</p>}
        <div className={s.dirList}>
          <p className={s.dirGroup}>Rules for all NBFCs</p>
          {core.filter(matches).map((d) => (
            <button
              key={d.document}
              type="button"
              className={cx(s.dirItem, selected === d.document && s.dirItemActive)}
              onClick={() => void load(d.document)}
            >
              <span>{d.shortTitle}</span>
              {d.hasChecklist && <span className={s.dirReady} title="Checklist ready">Ready</span>}
            </button>
          ))}
          <p className={s.dirGroup}>Specific types of NBFC</p>
          {typed.filter(matches).map((d) => (
            <button
              key={d.document}
              type="button"
              className={cx(s.dirItem, selected === d.document && s.dirItemActive)}
              onClick={() => void load(d.document)}
            >
              <span>{TYPE_OPTIONS.find((t) => t.value === directionType(d.document))?.label ?? d.shortTitle}</span>
              {d.hasChecklist && <span className={s.dirReady} title="Checklist ready">Ready</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className={s.toolMain}>
        {!selected && (
          <div className={s.toolEmpty}>
            <p className={s.toolEmptyTitle}>Choose a Direction on the left</p>
            <p>
              RegLens reads the whole Direction and lists every obligation: what you must do, have, or report, with the
              paragraph it comes from. The first time takes about a minute; after that it opens instantly.
            </p>
          </div>
        )}

        {loading && (
          <div className={s.toolLoading}>
            <Spinner />
            <div>
              <p className={s.toolLoadingTitle}>Reading the whole Direction</p>
              <p>This takes about 30 to 90 seconds the first time. The checklist is saved afterwards.</p>
            </div>
          </div>
        )}

        {error && <p className={s.toolError}>{error}</p>}

        {checklist && !loading && (
          <>
            <header className={s.toolHead}>
              <div>
                <h2 className={s.toolHeadTitle}>{checklist.title}</h2>
                <p className={s.toolHeadMeta}>
                  {versionText(checklist.date)}. {checklist.items.length} obligations found
                  {profileSet && notForYou > 0 ? `, ${notForYou} not for ${shortProfile(profile)}` : ''}.
                  {checklist.coverage && (
                    <>
                      {' '}
                      Items come from {checklist.coverage.withItems} of the {checklist.coverage.paragraphs} numbered paragraphs.{' '}
                      {checklist.coverage.without.length > 0 && (
                        <span title="These paragraphs produced no item. Most are definitions, scope or background; open them to confirm.">
                          No items from para {checklist.coverage.without.slice(0, 25).join(', ')}
                          {checklist.coverage.without.length > 25 ? '…' : ''}.
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
              <div className={s.toolHeadActions}>
                <button
                  type="button"
                  className={s.actionButton}
                  onClick={() =>
                    downloadCsv(
                      `RegLens checklist - ${checklist.title}.csv`,
                      ['Done', 'Obligation', 'Detail', 'Applies to', 'Category', 'Timing', 'Paragraph', 'Page', 'Verified'],
                      visible.map((it) => [
                        done[it.id] ? 'Yes' : '',
                        it.obligation,
                        it.detail,
                        it.appliesTo,
                        it.category,
                        timingText(it),
                        it.para,
                        it.page,
                        it.verified ? 'Yes' : 'No',
                      ]),
                    )
                  }
                >
                  Download as spreadsheet
                </button>
                <button type="button" className={s.linkButton} onClick={() => void load(checklist.document, true)}>
                  Regenerate
                </button>
              </div>
            </header>

            <div className={s.filterRow}>
              <button
                type="button"
                className={cx(s.filterChip, category === 'All' && s.filterChipActive)}
                onClick={() => setCategory('All')}
              >
                All ({checklist.items.length})
              </button>
              {categories.map(([cat, n]) => (
                <button
                  key={cat}
                  type="button"
                  className={cx(s.filterChip, category === cat && s.filterChipActive)}
                  onClick={() => setCategory(cat as Category)}
                >
                  {cat} ({n})
                </button>
              ))}
              {profileSet && (
                <label className={s.toggle}>
                  <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                  Only what applies to me
                </label>
              )}
            </div>

            <p className={s.progressText}>
              {doneCount} of {visible.length} marked done
            </p>

            <ul className={s.obligations}>
              {visible.map((it) => (
                <li key={it.id} className={cx(s.obligation, done[it.id] && s.obligationDone)}>
                  <input
                    type="checkbox"
                    className={s.obligationCheck}
                    checked={!!done[it.id]}
                    onChange={() => toggleDone(it.id)}
                    aria-label={`Mark done: ${it.obligation}`}
                  />
                  <div className={s.obligationBody}>
                    <p className={s.obligationText}>{it.obligation}</p>
                    {it.detail && <p className={s.obligationDetail}>{it.detail}</p>}
                    <div className={s.obligationMeta}>
                      <AppliesChip item={it} document={checklist.document} profile={profile} />
                      <span className={s.metaTag}>{it.appliesTo}</span>
                      {timingText(it) && <span className={cx(s.metaTag, s.metaTiming)}>{timingText(it)}</span>}
                      <CiteChip item={it} onClick={it.chunkId ? () => openSource(onOpen, chunks, it) : undefined} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {!visible.length && <p className={s.toolEmptyNote}>Nothing in this view. Try another category or turn off the filter.</p>}
            <p className={s.disclaimer}>
              Extracted by AI from the Direction and checked against its paragraphs. Information only, not legal advice.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
