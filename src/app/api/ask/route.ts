import type { NextRequest } from 'next/server';
import { askQuestionStream, type DoneEvent, type HistoryTurn, type SupportResult } from '../../../lib/qa';
import type { SearchResult } from '../../../lib/search';
import { sanitizeProfile } from '../../../lib/profile';
import { appendJsonl } from '../../../lib/store';

// No route segment config (runtime / dynamic / maxDuration): this project has cacheComponents on,
// which rejects them. Route handlers already run on Node.js and are dynamic by default.

// ---- Simple per-IP rate limit to protect the free Gemini quota on the public demo ----
// In-memory: resets when the server restarts, and each Vercel instance counts separately.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.REGLENS_RATE_LIMIT ?? 20);
const hits = new Map<string, number[]>();

function checkRateLimit(ip: string): { limited: boolean; retryAfterSec: number } {
  if (ip === 'local' || ip === '::1' || ip === '127.0.0.1') return { limited: false, retryAfterSec: 0 };
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return { limited: true, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { limited: false, retryAfterSec: 0 };
}

// Send the browser only what the UI needs (drops the embedding text and other internals).
function slim(r: SearchResult) {
  const c = r.chunk;
  return {
    rank: r.rank,
    score: r.score,
    vectorScore: r.vectorScore,
    bm25Score: r.bm25Score,
    via: r.via,
    chunk: {
      id: c.id,
      document: c.document,
      contextLine: c.contextLine,
      sourceUrl: c.sourceUrl,
      chapter: c.chapter,
      sections: c.sections ?? [],
      pageRange: c.pageRange,
      paragraphNumbers: c.paragraphNumbers ?? [],
      date: c.date,
      entity: c.entity,
      text: c.text,
    },
  };
}

function cleanHistory(input: unknown): HistoryTurn[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-2)
    .map((h) => ({
      question: String(h?.question ?? '').slice(0, 500),
      answer: String(h?.answer ?? '').slice(0, 4000),
    }))
    .filter((h) => h.question && h.answer);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the empty-question check
  }
  const question = String(body?.question ?? '').trim();
  if (!question) {
    return Response.json({ error: 'Please enter a question.' }, { status: 400 });
  }
  if (question.length > 500) {
    return Response.json({ error: 'Please keep questions under 500 characters.' }, { status: 400 });
  }
  const profile = sanitizeProfile(body?.profile);
  const history = cleanHistory(body?.history);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  const rl = checkRateLimit(ip);
  if (rl.limited) {
    return Response.json(
      {
        error: `Demo limit reached (${MAX_PER_WINDOW} questions per hour). Please try again in about ${Math.ceil(
          rl.retryAfterSec / 60,
        )} minutes.`,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Stream newline-delimited JSON events: status / token ... done ... support, or error.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      let done: DoneEvent | undefined;
      let support: SupportResult[] | undefined;
      let error: string | undefined;
      try {
        for await (const event of askQuestionStream(question, { profile, history })) {
          if (event.type === 'done') {
            done = event;
            send({ ...event, retrievedResults: event.retrievedResults.map(slim) });
          } else {
            if (event.type === 'support') support = event.results;
            if (event.type === 'error') error = event.message;
            send(event);
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Something went wrong.';
        send({ type: 'error', message: error });
      } finally {
        controller.close();
        // Audit trail: what was asked, what was answered, from which versions of which Directions.
        appendJsonl('audit.jsonl', {
          id: done?.id,
          at: new Date().toISOString(),
          question,
          standaloneQuestion: done?.standaloneQuestion,
          profile,
          followUp: history.length > 0,
          searchMode: done?.searchMode,
          searchQuery: done?.searchQuery,
          answer: done?.answer,
          notFoundReason: done?.notFoundReason,
          citations: done?.citations.map((c) => ({ title: c.documentTitle, para: c.paragraph, page: c.page })),
          unverifiedCitations: done?.unverifiedCitations.map((c) => ({ title: c.documentTitle, para: c.paragraph })),
          support: support?.map((s) => ({ title: s.title, para: s.paragraph, verdict: s.verdict, reason: s.reason })),
          directionVersions: done
            ? Array.from(new Map(done.retrievedResults.map((r) => [r.chunk.document, r.chunk.date])).entries()).map(
                ([document, date]) => ({ document, date }),
              )
            : [],
          model: done?.modelUsed,
          timeMs: done?.timeTakenMs,
          cached: done?.cached,
          cutShort: done?.cutShort,
          error,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
