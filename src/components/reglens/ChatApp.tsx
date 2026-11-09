'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';
import s from './reglens.module.css';
import EmptyState from './EmptyState';
import SourcePanel from './SourcePanel';
import TurnView from './TurnView';
import ProfileMenu, { loadProfile } from './ProfileMenu';
import ChecklistView from './ChecklistView';
import CalendarView from './CalendarView';
import PolicyCheckView from './PolicyCheckView';
import type { PanelState, ServerEvent, Turn } from './types';
import { cx, friendlyError } from './format';
import { ArrowIcon, CalendarIcon, DocCheckIcon, ListIcon, SealIcon, SearchIcon } from './icons';
import { DEFAULT_PROFILE, isProfileSet, shortProfile, type Profile } from '../../lib/profile';

type View = 'ask' | 'checklist' | 'calendar' | 'policy';

const VIEWS: { id: View; label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'ask', label: 'Ask', Icon: SearchIcon },
  { id: 'checklist', label: 'Checklists', Icon: ListIcon },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { id: 'policy', label: 'Policy check', Icon: DocCheckIcon },
];

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChatApp() {
  const [view, setView] = useState<View>('ask');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  // Read the saved profile after the first render (localStorage isn't available on the server).
  useEffect(() => setProfile(loadProfile()), []);

  const update = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const openPanel = useCallback((state: PanelState) => setPanel(state), []);
  const closePanel = useCallback(() => setPanel(null), []);

  // When a new question is asked, bring it to the top of the view.
  useEffect(() => {
    if (turns.length > lastCount.current) {
      latestRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    lastCount.current = turns.length;
  }, [turns.length]);

  // Let the composer grow with its text.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const id = newId();
      // Follow-ups: send the last two completed answers as context.
      const history = turns
        .filter((t) => t.status === 'done' && !t.isNotFound)
        .slice(-2)
        .map((t) => ({ question: t.standaloneQuestion || t.question, answer: t.answer }));
      const profileLabel = isProfileSet(profile) ? shortProfile(profile) : undefined;
      setBusy(true);
      setInput('');
      setPanel(null);
      setView('ask');
      setTurns((all) => [
        ...all,
        {
          id,
          question: q,
          answer: '',
          status: 'streaming',
          citations: [],
          unverified: [],
          results: [],
          steps: [],
          isFollowUp: history.length > 0,
          profileLabel,
        },
      ]);

      const fail = (message: string) =>
        update(id, (t) => ({ ...t, status: 'error', supportPending: false, error: friendlyError(message) }));

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, profile, history }),
        });

        if (!res.ok || !res.body) {
          let message = `The server returned an error (${res.status}).`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // keep the generic message
          }
          fail(message);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        const handle = (event: ServerEvent) => {
          if (event.type === 'status') {
            update(id, (t) => ({ ...t, steps: [...t.steps, { step: event.step, message: event.message }] }));
          } else if (event.type === 'token') {
            update(id, (t) => ({ ...t, answer: t.answer + event.content }));
          } else if (event.type === 'done') {
            finished = true;
            update(id, (t) => ({
              ...t,
              status: 'done',
              answerId: event.id,
              answer: event.answer,
              citations: event.citations,
              unverified: event.unverifiedCitations,
              results: event.retrievedResults,
              timeMs: event.timeTakenMs,
              model: event.modelUsed,
              isNotFound: event.isNotFound,
              notFoundReason: event.notFoundReason,
              searchMode: event.searchMode,
              searchQuery: event.searchQuery,
              standaloneQuestion: event.standaloneQuestion,
              cached: event.cached,
              supportPending: !event.isNotFound && event.citations.length > 0,
            }));
          } else if (event.type === 'support') {
            update(id, (t) => ({ ...t, support: event.results, supportPending: false }));
          } else {
            finished = true;
            fail(event.message);
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) handle(JSON.parse(line) as ServerEvent);
          }
        }
        if (buffer.trim()) handle(JSON.parse(buffer) as ServerEvent);
        if (!finished) fail('The answer was cut off before it finished.');
        update(id, (t) => ({ ...t, supportPending: false }));
      } catch (err) {
        fail(err instanceof Error ? err.message : 'RegLens could not reach the server.');
      } finally {
        setBusy(false);
        composerRef.current?.focus({ preventScroll: true });
      }
    },
    [busy, update, turns, profile],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  };

  const reset = () => {
    if (busy) return;
    setTurns([]);
    setPanel(null);
    setInput('');
    setView('ask');
  };

  const started = turns.length > 0;

  return (
    <div className={cx(s.app, panel && s.appWithPanel)}>
      <header className={s.topbar}>
        <div className={s.topbarInner}>
          <button type="button" className={s.wordmark} onClick={reset} aria-label="RegLens, start over">
            <SealIcon className={s.wordmarkSeal} />
            RegLens
          </button>
          <span className={s.badge}>Beta</span>
          <nav className={s.tabs} aria-label="RegLens tools">
            {VIEWS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={cx(s.tab, view === id && s.tabActive)}
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon className={s.tabIcon} />
                <span className={s.tabLabel}>{label}</span>
              </button>
            ))}
          </nav>
          <span className={s.spacer} />
          <ProfileMenu profile={profile} onChange={setProfile} />
          {started && view === 'ask' && (
            <button type="button" className={s.newButton} onClick={reset} disabled={busy}>
              New question
            </button>
          )}
        </div>
      </header>

      {view === 'checklist' && <ChecklistView profile={profile} onOpen={openPanel} />}
      {view === 'calendar' && <CalendarView profile={profile} onOpen={openPanel} />}
      {view === 'policy' && <PolicyCheckView profile={profile} onOpen={openPanel} />}

      {view === 'ask' &&
        (!started ? (
          <main>
            <EmptyState input={input} setInput={setInput} onAsk={(q) => void ask(q)} busy={busy} />
          </main>
        ) : (
          <>
            <main className={s.thread}>
              {turns.map((t, i) => (
                <div key={t.id} ref={i === turns.length - 1 ? latestRef : undefined} style={{ scrollMarginTop: 72 }}>
                  <TurnView turn={t} onOpen={openPanel} onAsk={(q) => void ask(q)} />
                </div>
              ))}
            </main>

            <div className={s.composer}>
              <form className={s.composerForm} onSubmit={onSubmit}>
                <label htmlFor="composer-question" className={s.srOnly}>
                  Ask a follow-up or a new question
                </label>
                <textarea
                  id="composer-question"
                  ref={composerRef}
                  className={s.composerInput}
                  rows={1}
                  maxLength={500}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask a follow-up, or a new question"
                />
                <button
                  type="submit"
                  className={s.sendButton}
                  disabled={busy || !input.trim()}
                  aria-label={busy ? 'Answering' : 'Ask'}
                >
                  {busy ? <span className={s.spinner} aria-hidden="true" /> : <ArrowIcon />}
                </button>
              </form>
              <p className={s.composerHint}>
                Follow-ups use your last two answers as context. Use New question to start fresh.
              </p>
            </div>
          </>
        ))}

      <SourcePanel state={panel} onClose={closePanel} />
    </div>
  );
}
