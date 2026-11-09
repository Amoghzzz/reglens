import type { NextRequest } from 'next/server';
import { runGapCheck } from '../../../lib/gapcheck';
import { chunksFor } from '../../../lib/obligations';
import { isProfileSet, sanitizeProfile } from '../../../lib/profile';
import { appendJsonl } from '../../../lib/store';

/** Compares a pasted or uploaded policy against one Direction's obligations. */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const document = String(body?.document ?? '');
  const policy = String(body?.policy ?? '').trim();
  if (!document) return Response.json({ error: 'Choose the Direction your policy should follow.' }, { status: 400 });
  if (policy.length < 200) {
    return Response.json({ error: 'Paste or upload the policy text (at least a few paragraphs).' }, { status: 400 });
  }
  const profile = sanitizeProfile(body?.profile);
  try {
    const result = await runGapCheck(document, policy, isProfileSet(profile) ? profile : undefined);
    appendJsonl('audit.jsonl', {
      at: new Date().toISOString(),
      kind: 'gap-check',
      document,
      profile,
      policyChars: policy.length,
      summary: {
        covered: result.results.filter((r) => r.status === 'covered').length,
        partial: result.results.filter((r) => r.status === 'partial').length,
        missing: result.results.filter((r) => r.status === 'missing').length,
      },
    });
    return Response.json({ ...result, chunks: chunksFor(result.results.map((r) => r.obligation)) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not run the check.' }, { status: 500 });
  }
}
