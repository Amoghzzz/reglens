import { getChecklist } from './obligations';
import { appliesToProfile, type Obligation } from './obligationTypes';
import { generateJson } from './llm';
import type { Profile } from './profile';

/**
 * Policy gap check: compares a company's internal policy against the obligations RegLens extracted
 * from one Direction, and reports each obligation as covered, partly covered or missing, with a quote
 * from the policy as evidence.
 */

export type GapStatus = 'covered' | 'partial' | 'missing';

export interface GapResult {
  obligation: Obligation;
  applies: 'yes' | 'no' | 'depends';
  status: GapStatus;
  evidence: string;
  note: string;
}

const MAX_POLICY_CHARS = 120000;

export async function runGapCheck(
  document: string,
  policyText: string,
  profile: Profile | undefined,
  apiKey?: string,
): Promise<{ title: string; date: string; results: GapResult[]; truncated: boolean; skipped: number }> {
  const checklist = await getChecklist(document, { apiKey });
  const relevant = checklist.items
    .map((o) => ({ o, applies: appliesToProfile(o, checklist.document, profile) }))
    .filter((x) => x.applies !== 'no');
  const skipped = checklist.items.length - relevant.length;
  const truncated = policyText.length > MAX_POLICY_CHARS;
  const policy = policyText.slice(0, MAX_POLICY_CHARS);

  if (!relevant.length) return { title: checklist.title, date: checklist.date, results: [], truncated, skipped };

  const list = relevant
    .map(({ o }, i) => `${i + 1}. ${o.obligation}${o.detail ? ` (${o.detail})` : ''} [para ${o.para}]`)
    .join('\n');

  const prompt = `You are a compliance reviewer. Compare the company POLICY below against each REQUIREMENT from the RBI ${checklist.title}.

For each requirement decide:
- "covered": the policy clearly addresses it, including the key numbers or conditions.
- "partial": the policy mentions it but misses a number, condition, frequency or responsibility, or is vague.
- "missing": the policy does not address it.
For "covered" and "partial", "evidence" must be a short exact quote from the policy (under 25 words). For "missing", "evidence" is "".
"note": under 20 words; for partial or missing, say what the policy needs to add.

Return JSON: {"results": [{"id": <requirement number>, "status": "covered" | "partial" | "missing", "evidence": "...", "note": "..."}]} with one entry per requirement, in order.

REQUIREMENTS:
${list}

POLICY:
${policy}`;

  const { data } = await generateJson<{ results?: { id: number; status: string; evidence?: string; note?: string }[] }>(
    prompt,
    { apiKey, thinking: 'low', maxOutputTokens: 32768, role: 'answer' },
  );
  const rows = Array.isArray(data.results) ? data.results : [];
  const results: GapResult[] = relevant.map(({ o, applies }, i) => {
    const r = rows.find((x) => Number(x.id) === i + 1);
    const status: GapStatus = r?.status === 'covered' || r?.status === 'partial' || r?.status === 'missing' ? r.status : 'missing';
    let evidence = String(r?.evidence ?? '').trim();
    // Only keep evidence that actually appears in the policy (guards against made-up quotes).
    if (evidence && !policy.toLowerCase().replace(/\s+/g, ' ').includes(evidence.toLowerCase().replace(/\s+/g, ' ').slice(0, 40))) {
      evidence = '';
    }
    return {
      obligation: o,
      applies,
      status: status === 'covered' && !evidence ? 'partial' : status,
      evidence,
      note: String(r?.note ?? (r ? '' : 'Could not be assessed.')).trim(),
    };
  });
  return { title: checklist.title, date: checklist.date, results, truncated, skipped };
}
