'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { answerAsText, printMemo } from './exportAnswer';
import s from './reglens.module.css';
import type { PanelState, Turn } from './types';
import {
  LEGAL_NOTICE,
  buildNotes,
  cx,
  docTitleOf,
  noteKey,
  paraRange,
  segments,
  shortTitle,
  splitApplies,
  splitTerm,
  toBlocks,
  type Block,
  type Note,
} from './format';
import { EXAMPLES } from './directions';
import { BookIcon, CautionIcon, CheckIcon, ChevronIcon, CopyIcon, FlagIcon, PrintIcon, SealIcon, SparkIcon, ThumbIcon } from './icons';

interface Props {
  turn: Turn;
  onOpen: (state: PanelState) => void;
  onAsk: (question: string) => void;
}

export default function TurnView({ turn, onOpen, onAsk }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const done = turn.status === 'done';
  const full = turn.answer.replace(LEGAL_NOTICE, '').trim();
  // While streaming, hide a citation that has started but not finished ("[RBI Credit Fac...").
  const partial = done ? full : full.replace(/\[[^\]\n]*$/, '').trimEnd();
  // The model signals off-topic / not-found questions with a single code word; never show it mid-stream.
  const text = !done && /^[\s*_`]*[A-Z_]{0,14}$/.test(partial) ? '' : partial;
  const blocks = useMemo(() => toBlocks(text), [text]);
  const { keyToN, notes, notesByBlock } = useMemo(() => buildNotes(blocks, turn), [blocks, turn]);

  const openNote = (note: Note) => {
    if (note.result) {
      onOpen({ result: note.result, paragraph: note.citation?.paragraph ?? note.part.para });
    } else {
      document.getElementById(noteId(turn.id, note.n))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const renderLine = (line: string): ReactNode =>
    segments(line).map((seg, i) => {
      if (seg.t === 'text') return <Fragment key={i}>{seg.v}</Fragment>;
      if (seg.t === 'bold') return <strong key={i}>{seg.v}</strong>;
      return (
        <Fragment key={i}>
          {seg.parts.map((part) => {
            const n = keyToN.get(noteKey(part));
            const note = n ? notes[n - 1] : undefined;
            if (!n || !note) return null;
            if (!done) {
              return (
                <span key={`${n}-${part.para}`} className={cx(s.marker, s.markerPending)} aria-hidden="true">
                  {n}
                </span>
              );
            }
            return (
              <button
                key={`${n}-${part.para}`}
                type="button"
                className={cx(s.marker, !note.verified && s.markerCaution, active === n && s.markerActive)}
                onMouseEnter={() => setActive(n)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(n)}
                onBlur={() => setActive(null)}
                onClick={() => openNote(note)}
                aria-label={`Source ${n}: ${shortTitle(note.title)}, paragraph ${note.part.para}${
                  note.verified ? '' : ' (not verified)'
                }`}
              >
                {n}
              </button>
            );
          })}
        </Fragment>
      );
    });

  const hasSections = blocks.some((b) => b.section !== null);

  const blockClass = (block: Block, bi: number, all: Block[]) => {
    if (block.section === 'short') {
      if (block.kind === 'h') return s.verdictHead;
      const next = all[bi + 1];
      return cx(s.verdict, (!next || next.section !== 'short') && s.verdictEnd);
    }
    if (!hasSections && bi === 0 && block.kind === 'p' && all.length > 1) return s.lead;
    return undefined;
  };

  const renderBlock = (block: Block): ReactNode => {
    if (block.kind === 'h') {
      if (block.section === 'short')
        return (
          <p className={s.verdictLabel}>
            <SparkIcon className={s.verdictIcon} />
            {block.lines[0]}
          </p>
        );
      return (
        <h3
          className={cx(
            s.subhead,
            block.section === 'exceptions' && s.subheadCaution,
            block.section === 'applies' && s.subheadApplies,
          )}
        >
          {renderLine(block.lines[0])}
          {block.section === 'applies' && turn.profileLabel && <span className={s.subheadNote}> ({turn.profileLabel})</span>}
        </h3>
      );
    }
    if (block.kind === 'p') return <p>{renderLine(block.lines[0])}</p>;
    if (block.section === 'applies') {
      return (
        <ul className={s.applies}>
          {block.lines.map((line, li) => {
            const a = splitApplies(line);
            const label = a?.kind === 'applies' ? 'Applies' : a?.kind === 'not' ? 'Does not apply' : a?.kind === 'depends' ? 'Depends' : null;
            return (
              <li key={li} className={s.appliesItem}>
                {label && (
                  <span
                    className={cx(
                      s.appliesTag,
                      a?.kind === 'applies' && s.appliesYes,
                      a?.kind === 'not' && s.appliesNo,
                      a?.kind === 'depends' && s.appliesMaybe,
                    )}
                  >
                    {label}
                  </span>
                )}
                <span>{renderLine(a ? a.text : line)}</span>
              </li>
            );
          })}
        </ul>
      );
    }
    if (block.section === 'terms') {
      return (
        <>
        <p className={s.termsNote}>Plain-English explanations to help you read the answer. They are not RBI definitions unless cited.</p>
        <dl className={s.terms}>
          {block.lines.map((line, li) => {
            const t = splitTerm(line);
            return t ? (
              <div key={li} className={s.term}>
                <dt>{t.term}</dt>
                <dd>{renderLine(t.meaning)}</dd>
              </div>
            ) : (
              <div key={li} className={s.term}>
                <dd>{renderLine(line)}</dd>
              </div>
            );
          })}
        </dl>
        </>
      );
    }
    const items = block.lines.map((line, li) => <li key={li}>{renderLine(line)}</li>);
    return block.kind === 'ol' ? <ol className={s.numbered}>{items}</ol> : <ul className={s.bullets}>{items}</ul>;
  };

  const verifiedCount = notes.filter((n) => n.verified).length;
  const checked = (turn.support ?? []).length;
  const fullySupported = (turn.support ?? []).filter((x) => x.verdict === 'supported').length;
  const directionsUsed = new Set(notes.filter((n) => n.verified).map((n) => n.title)).size;
  const citedChunks = new Set(notes.map((n) => n.result?.chunk.id).filter(Boolean));

  return (
    <section className={s.turn} aria-busy={turn.status === 'streaming'}>
      <h2 className={s.question}>{turn.question}</h2>
      {(turn.isFollowUp || turn.profileLabel) && (
        <p className={s.context}>
          {turn.isFollowUp && turn.standaloneQuestion && turn.standaloneQuestion !== turn.question && (
            <span>
              Follow-up, read as: <q>{turn.standaloneQuestion}</q>
            </span>
          )}
          {turn.profileLabel && <span className={s.contextProfile}>Answered for: {turn.profileLabel}</span>}
        </p>
      )}

      {/* Progress: what RegLens is doing right now */}
      {turn.status === 'streaming' && (
        <ol className={s.steps} role="status" aria-live="polite">
          {(turn.steps.length ? turn.steps : [{ step: 'rewrite', message: 'Understanding your question' }]).map((st, i, all) => {
            const current = i === all.length - 1;
            return (
              <li key={`${st.step}-${i}`} className={cx(s.step, current ? s.stepCurrent : s.stepDone)}>
                {current ? <span className={s.pulse} aria-hidden="true" /> : <CheckIcon className={s.stepIcon} />}
                {st.message}
              </li>
            );
          })}
        </ol>
      )}

      {done && !turn.isNotFound && (
        <div className={s.status}>
          {notes.length > 0 && verifiedCount === notes.length && (
            <span className={cx(s.pill, s.pillSeal)}>
              <SealIcon className={s.pillIcon} />
              {notes.length === 1 ? 'Citation verified' : `All ${notes.length} citations verified`}
            </span>
          )}
          {notes.length > 0 && verifiedCount < notes.length && (
            <span className={cx(s.pill, s.pillCaution)}>
              <CautionIcon className={s.pillIcon} />
              {verifiedCount} of {notes.length} citations verified
            </span>
          )}
          {notes.length === 0 && (
            <span className={cx(s.pill, s.pillCaution)}>
              <CautionIcon className={s.pillIcon} />
              No citations given. Treat with care.
            </span>
          )}
          {turn.searchMode === 'all_directions' && (
            <span className={cx(s.pill, s.pillInfo)}>
              <BookIcon className={s.pillIcon} />
              Checked all {new Set(turn.results.map((r) => r.chunk.document)).size} Directions
            </span>
          )}
          {directionsUsed > 0 && (
            <span className={s.meta}>
              Cites {directionsUsed} {directionsUsed === 1 ? 'Direction' : 'Directions'}
            </span>
          )}
          {turn.supportPending && (
            <span className={cx(s.pill, s.pillWorking)}>
              <span className={s.pulse} aria-hidden="true" />
              Checking each claim against its source
            </span>
          )}
          {!turn.supportPending && checked > 0 && (
            <span className={cx(s.pill, fullySupported === checked ? s.pillSeal : s.pillCaution)}>
              {fullySupported === checked ? <SealIcon className={s.pillIcon} /> : <CautionIcon className={s.pillIcon} />}
              {fullySupported === checked
                ? `All ${checked} claims supported by their source`
                : `${fullySupported} of ${checked} claims fully supported`}
            </span>
          )}
          {turn.cached ? (
            <span className={s.meta}>Saved answer, shown instantly</span>
          ) : (
            turn.timeMs !== undefined && <span className={s.meta}>{(turn.timeMs / 1000).toFixed(1)} s</span>
          )}
        </div>
      )}

      {/* Body */}
      {turn.status === 'error' ? (
        <div className={cx(s.notice, s.noticeError)} role="alert">
          <p className={s.noticeTitle}>RegLens couldn&apos;t answer this</p>
          <p className={s.noticeBody}>{turn.error}</p>
          <button type="button" className={s.retryButton} onClick={() => onAsk(turn.question)}>
            Ask again
          </button>
        </div>
      ) : done && turn.isNotFound ? (
        <NotFound turn={turn} onAsk={onAsk} />
      ) : !text ? (
        <div className={s.skeleton} aria-hidden="true">
          <div className={s.skeletonLine} style={{ width: '92%' }} />
          <div className={s.skeletonLine} style={{ width: '86%' }} />
          <div className={s.skeletonLine} style={{ width: '64%' }} />
        </div>
      ) : (
        <div className={s.answer}>
          {blocks.map((block, bi) => (
            <div className={s.row} key={bi}>
              <aside className={s.rowNotes} aria-label={notesByBlock[bi].length ? 'Sources' : undefined}>
                {done &&
                  notesByBlock[bi].map((n) => (
                    <NoteCard
                      key={n}
                      id={noteId(turn.id, n)}
                      note={notes[n - 1]}
                      compact={notes.length > 10}
                      active={active === n}
                      onHover={(on) => setActive(on ? n : null)}
                      onOpen={() => openNote(notes[n - 1])}
                    />
                  ))}
              </aside>
              <div className={cx(s.rowMain, blockClass(block, bi, blocks))}>{renderBlock(block)}</div>
            </div>
          ))}
        </div>
      )}

      {/* How the answer was found */}
      {done && turn.results.length > 0 && turn.notFoundReason !== 'off_topic' && (
        <details className={s.trace}>
          <summary>
            <ChevronIcon className={s.traceChevron} />
            See the {turn.results.length} passages RegLens read
          </summary>
          <ol className={s.traceList}>
            {turn.results.map((r) => {
              const pct = Math.max(4, Math.min(100, ((r.vectorScore - 0.45) / 0.45) * 100));
              const used = citedChunks.has(r.chunk.id);
              return (
                <li key={r.chunk.id}>
                  <button type="button" className={s.traceItem} onClick={() => onOpen({ result: r })}>
                    <span className={s.traceRank}>{r.rank}</span>
                    <span className={s.traceText}>
                      <span className={s.traceTitle}>{shortTitle(docTitleOf(r.chunk))}</span>
                      <span className={s.traceRef}>
                        {paraRange(r.chunk) || 'Introduction'}, page {r.chunk.pageRange}
                        {used && <span className={s.traceUsed}>, cited in the answer</span>}
                        {r.via === 'crossref' && <span className={s.traceVia}>, followed from a cross-reference</span>}
                        {r.via === 'profile' && <span className={s.traceVia}>, from your type of NBFC</span>}
                      </span>
                    </span>
                    <span className={s.traceMeter}>
                      <span>Similarity {r.vectorScore.toFixed(2)}</span>
                      <span className={s.traceBar} aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className={s.traceNote}>
            {turn.searchQuery && turn.searchQuery !== turn.question && (
              <>
                Searched in RBI&apos;s wording: <q className={s.traceQuery}>{turn.searchQuery}</q>
                <br />
              </>
            )}
            {turn.searchMode === 'all_directions'
              ? 'For this list question RegLens read the top passages plus the best passage from every Direction. '
              : 'Ranked by combining meaning-based search with keyword search. '}
            The answer was written only from these passages.
          </p>
        </details>
      )}

      {done && !turn.isNotFound && <AnswerActions turn={turn} />}
      {(done || turn.status === 'error') && <p className={s.disclaimer}>{LEGAL_NOTICE}</p>}
    </section>
  );
}

function NotFound({ turn, onAsk }: { turn: Turn; onAsk: (q: string) => void }) {
  const offTopic = turn.notFoundReason === 'off_topic';
  const suggestions = EXAMPLES.slice(0, 3);
  return (
    <div className={s.notice}>
      <p className={s.noticeTitle}>
        {offTopic ? 'RegLens only answers questions about RBI rules for NBFCs' : "This isn't covered in the Directions RegLens has read"}
      </p>
      <p className={s.noticeBody}>
        {offTopic
          ? "This question looks like it's about something else, so RegLens hasn't tried to answer it. It's built for one job: finding what the RBI's Master Directions say about NBFCs, and showing you exactly where they say it."
          : 'RegLens searched all 35 Master Directions for NBFCs and found nothing that answers this, so it won\u2019t guess. The answer may be in other RBI documents, such as circulars or monetary policy announcements, which RegLens doesn\u2019t cover yet.'}
      </p>
      <p className={s.noticeSub}>{offTopic ? 'Questions RegLens can answer' : 'Questions the Directions do answer'}</p>
      <ul className={s.suggestions}>
        {suggestions.map((q) => (
          <li key={q}>
            <button type="button" className={s.suggestion} onClick={() => onAsk(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerActions({ turn }: { turn: Turn }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<'up' | 'down' | 'flag' | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [note, setNote] = useState('');
  const [popupBlocked, setPopupBlocked] = useState(false);

  const send = async (r: 'up' | 'down' | 'flag', text = '') => {
    setRating(r);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: turn.answerId, rating: r, note: text, question: turn.question }),
      });
    } catch {
      // feedback is best-effort
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerAsText(turn));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={s.actions}>
      <div className={s.actionGroup}>
        <button type="button" className={s.actionButton} onClick={copy}>
          <CopyIcon />
          {copied ? 'Copied with sources' : 'Copy'}
        </button>
        <button
          type="button"
          className={s.actionButton}
          onClick={() => setPopupBlocked(!printMemo(turn, turn.profileLabel))}
        >
          <PrintIcon />
          Save as PDF memo
        </button>
      </div>
      <div className={s.actionGroup}>
        {rating && rating !== 'flag' ? (
          <span className={s.thanks}>Thanks for the feedback</span>
        ) : rating === 'flag' ? (
          <span className={s.thanks}>Flagged for review</span>
        ) : (
          <>
            <span className={s.actionLabel}>Was this helpful?</span>
            <button type="button" className={s.iconAction} onClick={() => send('up')} aria-label="Helpful">
              <ThumbIcon />
            </button>
            <button type="button" className={s.iconAction} onClick={() => send('down')} aria-label="Not helpful">
              <ThumbIcon down />
            </button>
            <button type="button" className={s.iconAction} onClick={() => setFlagOpen((v) => !v)} aria-label="Flag a problem">
              <FlagIcon />
            </button>
          </>
        )}
      </div>
      {popupBlocked && (
        <p className={s.actionHint}>Your browser blocked the memo window. Allow pop-ups for this site and try again.</p>
      )}
      {flagOpen && !rating && (
        <form
          className={s.flagForm}
          onSubmit={(e) => {
            e.preventDefault();
            void send('flag', note);
            setFlagOpen(false);
          }}
        >
          <label htmlFor={`flag-${turn.id}`} className={s.flagLabel}>
            What&apos;s wrong with this answer?
          </label>
          <textarea
            id={`flag-${turn.id}`}
            className={s.flagInput}
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For example: the limit quoted is for a different layer"
          />
          <button type="submit" className={s.flagSubmit}>
            Flag answer
          </button>
        </form>
      )}
    </div>
  );
}

function noteId(turnId: string, n: number) {
  return `note-${turnId}-${n}`;
}

function NoteCard({
  id,
  note,
  compact,
  active,
  onHover,
  onOpen,
}: {
  id: string;
  note: Note;
  compact: boolean;
  active: boolean;
  onHover: (on: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <div
      id={id}
      className={cx(s.note, compact && s.noteCompact, active && s.noteActive, !note.verified && s.noteCaution)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className={s.noteHead}>
        <span className={s.noteNum}>{note.n}</span>
        <span className={s.noteTitle}>{shortTitle(note.title)}</span>
      </div>
      <div className={s.noteRef}>
        Paragraph {note.part.para}
        {note.page ? `, page ${note.page}` : ''}
        {note.verified && (
          <span className={s.noteVerified}>
            <CheckIcon />
            Verified
          </span>
        )}
      </div>
      {note.support && note.support.verdict !== 'supported' && (
        <p className={cx(s.noteSupport, note.support.verdict === 'unsupported' && s.noteSupportBad)}>
          {note.support.verdict === 'partial' ? 'Partly supported' : 'Not supported by this paragraph'}
          {note.support.reason ? `: ${note.support.reason}` : ''}
        </p>
      )}
      {note.support?.verdict === 'supported' && !compact && <p className={s.noteSupportOk}>Claim matches the source</p>}
      {note.excerpt && !compact && (
        <p className={s.noteExcerpt}>
          <mark>{note.excerpt}</mark>
        </p>
      )}
      {note.verified ? (
        <button type="button" className={cx(s.noteOpen, compact && s.noteOpenCompact)} onClick={onOpen}>
          {compact ? 'Read the paragraph' : 'Read the full paragraph'}
        </button>
      ) : (
        <p className={s.noteWarn}>
          RegLens couldn&apos;t match this to the passages it read. Check the Direction before relying on it.
        </p>
      )}
    </div>
  );
}
