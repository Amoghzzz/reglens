import { connection } from 'next/server';
import { readJsonl } from '../../../lib/store';

/** Recent questions, answers and feedback, newest first, for the Audit page. */
export async function GET() {
  await connection();
  const entries = readJsonl<Record<string, any>>('audit.jsonl', 300).reverse();
  const feedback = readJsonl<Record<string, any>>('feedback.jsonl', 1000);
  const byId = new Map<string, Record<string, any>[]>();
  for (const f of feedback) {
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id)!.push(f);
  }
  return Response.json({ entries: entries.map((e) => ({ ...e, feedback: e.id ? byId.get(e.id) ?? [] : [] })) });
}
