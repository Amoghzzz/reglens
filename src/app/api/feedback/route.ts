import type { NextRequest } from 'next/server';
import { appendJsonl } from '../../../lib/store';

/** Records a user's rating of an answer ("helpful" / "not helpful" / "flag") against the answer's audit id. */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const id = String(body?.id ?? '').slice(0, 64);
  const rating = ['up', 'down', 'flag'].includes(body?.rating) ? body.rating : null;
  if (!id || !rating) return Response.json({ error: 'Missing answer id or rating.' }, { status: 400 });
  appendJsonl('feedback.jsonl', {
    id,
    rating,
    note: String(body?.note ?? '').slice(0, 1000),
    question: String(body?.question ?? '').slice(0, 500),
    at: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}
