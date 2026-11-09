import type { NextRequest } from 'next/server';
import { chunksFor, getChecklist } from '../../../lib/obligations';

/** Returns the obligations checklist for one Direction, generating and saving it on first request. */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const document = String(body?.document ?? '');
  if (!document) return Response.json({ error: 'Choose a Direction.' }, { status: 400 });
  try {
    const checklist = await getChecklist(document, { refresh: body?.refresh === true });
    return Response.json({ checklist, chunks: chunksFor(checklist.items) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not build the checklist.' }, { status: 500 });
  }
}
