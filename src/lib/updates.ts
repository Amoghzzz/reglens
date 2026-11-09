import { listDirections } from './obligations';
import { readJson, writeJson } from './store';

/**
 * Update checker: reads the RBI's public Master Directions page and compares each NBFC-family Direction's
 * latest date with the version RegLens has indexed. It only reports; re-indexing a newer PDF is a manual step.
 */

export const RBI_LIST_URL = 'https://rbi.org.in/Scripts/BS_ViewMasterDirections.aspx';
const CACHE = 'updates.json';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface RbiEntry {
  id: string;
  title: string;
  entity: string; // NBFC, HFC, CIC, MGC, SPD, NOFHC
  subject: string; // e.g. "Governance"; empty for single-Direction types such as HFC
  date: string; // ISO: "Updated as on" date if given, else the date heading it is listed under
  dateSource: 'updated' | 'listed';
  url: string;
}

// newer: the RBI title says "Updated as on" a later date. check: only the list heading is later, which may mean
// an amendment or just a re-listing, so a person should look.
export type UpdateState = 'current' | 'newer' | 'check' | 'missing';

export interface UpdateRow {
  document: string;
  shortTitle: string;
  indexedDate: string;
  state: UpdateState;
  rbi?: RbiEntry;
}

export interface UpdateReport {
  checkedAt: string;
  ok: boolean;
  error?: string;
  rows: UpdateRow[];
  notIndexed: RbiEntry[]; // NBFC-family Directions on the RBI site that RegLens does not cover
}

const ENTITY_NAMES: [RegExp, string][] = [
  [/^non[-\s]?banking financial compan(?:y|ies)/i, 'NBFC'],
  [/^housing finance compan(?:y|ies)/i, 'HFC'],
  [/^core investment compan(?:y|ies)/i, 'CIC'],
  [/^mortgage guarantee compan(?:y|ies)/i, 'MGC'],
  [/^standalone primary dealers?/i, 'SPD'],
  [/^non[-\s]?operative financial holding compan(?:y|ies)/i, 'NOFHC'],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "October 01, 2026" or "Oct 7, 2026" to "2026-10-01". */
export function isoDate(text: string): string | null {
  const m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits "Reserve Bank of India (Non-Banking Financial Companies – Governance) Directions, 2025" into entity and subject. */
export function classifyTitle(title: string): { entity: string; subject: string } | null {
  const m = title.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(Supervisory\s+|Master\s+)?Directions?/i);
  if (!m) return null;
  const [head, ...rest] = m[1].split(/\s+[–—-]\s+/);
  const supervisory = /supervisory/i.test(m[2] ?? '');
  for (const [re, entity] of ENTITY_NAMES) {
    if (re.test(head.trim())) {
      const subject = rest.join(' - ').trim();
      return { entity, subject: supervisory ? `${subject} (Supervisory)`.trim() : subject };
    }
  }
  return null;
}

/** Pulls every Master Direction link and its date from the RBI list page. */
export function parseRbiList(html: string): RbiEntry[] {
  const token =
    /<a\b[^>]*href=["']?([^"'\s>]*BS_ViewMasDirections\.aspx\?id=(\d+))["']?[^>]*>([\s\S]*?)<\/a>|\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\b/g;
  const byId = new Map<string, RbiEntry>();
  let issueDate = '';
  for (const m of html.matchAll(token)) {
    if (m[4]) {
      issueDate = isoDate(m[4]) ?? issueDate;
      continue;
    }
    const title = decode(m[3]);
    if (!title) continue;
    const kind = classifyTitle(title);
    if (!kind) continue;
    const updated = title.match(/updated\s+as\s+on\s+([^)]+)\)/i)?.[1];
    const updatedIso = updated ? isoDate(updated) : null;
    const date = updatedIso || issueDate;
    const dateSource: RbiEntry['dateSource'] = updatedIso ? 'updated' : 'listed';
    const url = m[1].startsWith('http') ? m[1] : `https://rbi.org.in/Scripts/${m[1].replace(/^.*?(BS_ViewMasDirections)/, '$1')}`;
    const prev = byId.get(m[2]);
    if (!prev || date > prev.date) byId.set(m[2], { id: m[2], title, ...kind, date, dateSource, url });
  }
  return Array.from(byId.values());
}

const FILLER = new Set(['and', 'of', 'on', 'the', 'for', 'in', 'to', 'a']);
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(?:ies)$/, 'y').replace(/s$/, '') : w));
}

function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return A.size === B.size ? 1 : 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/** "Governance Directions for NBFCs (updated …)" style titles: the subject RegLens uses for each Direction. */
function indexedSubject(entity: string, shortTitle: string): string {
  return entity === 'NBFC' ? shortTitle : '';
}

export function compare(entries: RbiEntry[]): Pick<UpdateReport, 'rows' | 'notIndexed'> {
  const directions = listDirections();
  const used = new Set<string>();
  const rows: UpdateRow[] = directions.map((d) => {
    const subject = indexedSubject(d.entity, d.shortTitle);
    let best: RbiEntry | undefined;
    let bestScore = 0;
    for (const e of entries) {
      // Same entity: compare subjects. A type-specific Direction (HFC, CIC...) may also be listed under the
      // NBFC heading with its type as the subject, so compare that subject with the Direction's title.
      const score =
        e.entity === d.entity
          ? subject || e.subject
            ? similarity(subject, e.subject)
            : 1
          : e.entity === 'NBFC' && d.entity !== 'NBFC'
            ? similarity(d.shortTitle, e.subject)
            : 0;
      if (score > bestScore || (score === bestScore && best && e.date > best.date)) {
        best = e;
        bestScore = score;
      }
    }
    if (!best || bestScore < 0.6) return { document: d.document, shortTitle: d.shortTitle, indexedDate: d.date, state: 'missing' };
    used.add(best.id);
    return {
      document: d.document,
      shortTitle: d.shortTitle,
      indexedDate: d.date,
      state: best.date > d.date ? (best.dateSource === 'updated' ? 'newer' : 'check') : 'current',
      rbi: best,
    };
  });
  const notIndexed = entries.filter((e) => !used.has(e.id)).sort((a, b) => b.date.localeCompare(a.date));
  return { rows, notIndexed };
}

export function cachedReport(): UpdateReport | null {
  return readJson<UpdateReport>(CACHE);
}

export async function checkForUpdates(refresh = false): Promise<UpdateReport> {
  const cached = cachedReport();
  if (!refresh && cached?.ok && Date.now() - Date.parse(cached.checkedAt) < MAX_AGE_MS) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(RBI_LIST_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`The RBI site answered with status ${res.status}.`);
    const entries = parseRbiList(await res.text());
    if (!entries.length) throw new Error('Could not find any NBFC Master Directions on the RBI page. Its layout may have changed.');
    const report: UpdateReport = { checkedAt: new Date().toISOString(), ok: true, ...compare(entries) };
    writeJson(CACHE, report);
    return report;
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'The RBI site took too long to respond.'
        : err instanceof Error
          ? err.message
          : 'Could not reach the RBI site.';
    if (cached?.ok) return { ...cached, error: `Showing the last successful check. This time: ${message}` };
    return { checkedAt: new Date().toISOString(), ok: false, error: message, rows: [], notIndexed: [] };
  } finally {
    clearTimeout(timer);
  }
}
