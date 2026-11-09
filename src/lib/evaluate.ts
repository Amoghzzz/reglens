import { askQuestion, type QAResult } from './qa';
import { quotaInfo, sleep } from './llm';
import { readJson, readProjectJson, writeJson } from './store';
import { sanitizeProfile, type Profile } from './profile';

/**
 * Evaluation: runs the test questions in data/eval/questions.json through the full pipeline and scores
 * each answer in code (no AI judging the AI for the headline numbers):
 * - correct: the answer contains every expected fact (numbers, terms)
 * - cited correctly: a verified citation points to the expected Direction (and paragraph, if given)
 * - refused correctly: not-covered and trap questions get "not found" / "outside scope"
 * - supported: share of cited claims the claim-check rated "supported"
 */

export interface EvalQuestion {
  id: string;
  group: 'direct' | 'exception' | 'list' | 'notfound' | 'trap';
  question: string;
  mustContain?: string[][];
  expectedDoc?: string;
  expectedParas?: string[];
  minDirectionsCited?: number;
  expectNotFound?: boolean;
  profile?: Partial<Profile>;
}

export interface EvalResult {
  id: string;
  group: EvalQuestion['group'];
  question: string;
  pass: boolean;
  correct: boolean | null;
  citedCorrectly: boolean | null;
  refusedCorrectly: boolean | null;
  missingFacts: string[];
  directionsCited: number;
  citations: number;
  unverified: number;
  supported: number;
  partial: number;
  unsupported: number;
  /** Claims the claim check did not rate fully supported, with its reason, for review. */
  flaggedClaims?: { verdict: string; statement: string; source: string; reason: string }[];
  timeMs: number;
  searchMode: string;
  answer: string;
  error?: string;
  at: string;
}

export interface EvalRun {
  startedAt: string;
  finishedAt?: string;
  model?: string;
  results: EvalResult[];
}

const RUN_FILE = 'eval/latest.json';

export function loadQuestions(): EvalQuestion[] {
  return readProjectJson<{ questions: EvalQuestion[] }>('data/eval/questions.json')?.questions ?? [];
}

export function loadLatestRun(): EvalRun | null {
  return readJson<EvalRun>(RUN_FILE);
}

function norm(s: string) {
  // "25 per cent", "25 percent" and "25%" are the same fact; the RBI text and the AI use all three.
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:per\s?cent|percent)\b/g, '%')
    .replace(/(\d)\s+%/g, '$1%');
}

export function scoreAnswer(q: EvalQuestion, r: QAResult): Omit<EvalResult, 'at'> {
  const answer = norm(r.answer);
  const citedDocs = new Map<string, Set<string>>();
  for (const c of r.citations) {
    const doc = r.retrievedResults.find((x) => x.chunk.id === c.matchingChunkId)?.chunk.document ?? c.documentTitle;
    if (!citedDocs.has(doc)) citedDocs.set(doc, new Set());
    citedDocs.get(doc)!.add(c.paragraph.match(/^(\d+[A-Za-z]?)/)?.[1] ?? c.paragraph);
  }
  const support = { supported: 0, partial: 0, unsupported: 0 };
  r.support.forEach((s) => support[s.verdict]++);

  let correct: boolean | null = null;
  let citedCorrectly: boolean | null = null;
  let refusedCorrectly: boolean | null = null;
  const missingFacts: string[] = [];

  if (q.expectNotFound) {
    refusedCorrectly = r.isNotFound;
  } else {
    if (r.isNotFound) {
      correct = false;
      missingFacts.push('(answered "not found")');
    } else {
      for (const group of q.mustContain ?? []) {
        if (!group.some((alt) => answer.includes(norm(alt)))) missingFacts.push(group.join(' / '));
      }
      if (q.minDirectionsCited && citedDocs.size < q.minDirectionsCited) {
        missingFacts.push(`cites ${citedDocs.size} Directions, expected at least ${q.minDirectionsCited}`);
      }
      correct = missingFacts.length === 0;
    }
    if (q.expectedDoc) {
      const docHits = Array.from(citedDocs.entries()).filter(([doc]) => doc.toLowerCase().includes(q.expectedDoc!.toLowerCase()));
      citedCorrectly =
        docHits.length > 0 && (!q.expectedParas?.length || docHits.some(([, paras]) => q.expectedParas!.some((p) => paras.has(p))));
    }
  }

  const pass = (correct ?? true) && (citedCorrectly ?? true) && (refusedCorrectly ?? true);
  return {
    id: q.id,
    group: q.group,
    question: q.question,
    pass,
    correct,
    citedCorrectly,
    refusedCorrectly,
    missingFacts,
    directionsCited: citedDocs.size,
    citations: r.citations.length + r.unverifiedCitations.length,
    unverified: r.unverifiedCitations.length,
    ...support,
    flaggedClaims: r.support
      .filter((s) => s.verdict !== 'supported')
      .map((s) => ({ verdict: s.verdict, statement: s.statement, source: `${s.title}, para ${s.paragraph}`, reason: s.reason })),
    timeMs: r.timeTakenMs,
    searchMode: r.searchMode,
    answer: r.answer,
  };
}

/** Runs the evaluation, saving after each question so an interrupted run (e.g. quota) can resume. */
export async function runEvaluation(opts: { only?: string[]; fresh?: boolean; onResult?: (r: EvalResult, i: number, n: number) => void } = {}) {
  const questions = loadQuestions().filter((q) => !opts.only?.length || opts.only.includes(q.id));
  const previous = opts.fresh ? null : loadLatestRun();
  const run: EvalRun = previous && !previous.finishedAt ? previous : { startedAt: new Date().toISOString(), results: [] };
  if (opts.only?.length && previous) run.results = previous.results.filter((r) => !opts.only!.includes(r.id));

  const todo = questions.filter((q) => !run.results.some((r) => r.id === q.id && !r.error));
  run.results = run.results.filter((r) => !r.error);
  for (let i = 0; i < todo.length; i++) {
    const q = todo[i];
    let result: EvalResult;
    try {
      let r;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await askQuestion(q.question, { profile: q.profile ? sanitizeProfile(q.profile) : undefined, skipCache: true });
          break;
        } catch (err) {
          const quota = quotaInfo(err);
          // Per-minute limits pass: wait and ask again. The daily allowance does not, so give up on it.
          if (!quota.isQuota || quota.daily || attempt >= 2) throw err;
          console.warn(`Rate limited on ${q.id}; waiting ${Math.round(quota.retryMs / 1000)}s and retrying.`);
          await sleep(Math.min(Math.max(quota.retryMs, 20_000), 65_000));
        }
      }
      run.model = r.modelUsed;
      result = { ...scoreAnswer(q, r), at: new Date().toISOString() };
    } catch (err) {
      result = {
        id: q.id,
        group: q.group,
        question: q.question,
        pass: false,
        correct: null,
        citedCorrectly: null,
        refusedCorrectly: null,
        missingFacts: [],
        directionsCited: 0,
        citations: 0,
        unverified: 0,
        supported: 0,
        partial: 0,
        unsupported: 0,
        timeMs: 0,
        searchMode: '',
        answer: '',
        error: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
    }
    run.results = [...run.results.filter((x) => x.id !== q.id), result];
    writeJson(RUN_FILE, run);
    opts.onResult?.(result, i + 1, todo.length);
    if (result.error && quotaInfo(result.error).daily) break;
  }
  if (run.results.length >= questions.length && run.results.every((r) => !r.error)) run.finishedAt = new Date().toISOString();
  writeJson(RUN_FILE, run);
  return run;
}

export function summarize(run: EvalRun | null, questions: EvalQuestion[]) {
  const results = run?.results ?? [];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const answerable = results.filter((r) => r.correct !== null);
  const cited = results.filter((r) => r.citedCorrectly !== null);
  const refusals = results.filter((r) => r.refusedCorrectly !== null);
  const claims = results.reduce((a, r) => a + r.supported + r.partial + r.unsupported, 0);
  const supported = results.reduce((a, r) => a + r.supported, 0);
  const times = results.filter((r) => r.timeMs > 0 && r.searchMode === 'focused').map((r) => r.timeMs).sort((a, b) => a - b);
  return {
    total: questions.length,
    run: results.length,
    passed: results.filter((r) => r.pass).length,
    correctPct: pct(answerable.filter((r) => r.correct).length, answerable.length),
    citationPct: pct(cited.filter((r) => r.citedCorrectly).length, cited.length),
    refusalPct: pct(refusals.filter((r) => r.refusedCorrectly).length, refusals.length),
    supportedPct: pct(supported, claims),
    claims,
    medianSec: times.length ? Math.round(times[Math.floor(times.length / 2)] / 100) / 10 : null,
    startedAt: run?.startedAt,
    finishedAt: run?.finishedAt,
    model: run?.model,
  };
}
