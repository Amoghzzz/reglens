import { loadSearchIndex, type ChunkMetadata } from './search';
import { chunkHasPara } from './citations';
import { generateJson } from './llm';
import { readJson, writeJson } from './store';
import type { Category, Checklist, Obligation, Timing } from './obligationTypes';
export type { Category, Checklist, Obligation, Timing } from './obligationTypes';
export { appliesToProfile } from './obligationTypes';

/**
 * Obligations: the "must do" rules in a Direction, extracted once by the AI with a paragraph citation for
 * each, checked in code, and saved. Checklists show them; the calendar collects the ones with deadlines;
 * the policy check compares a policy against them.
 */

export interface DirectionInfo {
  document: string;
  title: string;
  shortTitle: string;
  date: string;
  entity: string;
  chunks: number;
  words: number;
  hasChecklist: boolean;
}

function titleOf(chunk: ChunkMetadata): string {
  return chunk.contextLine.split('>')[0].replace(/[\[\]]/g, '').trim();
}

export function shortTitleOf(title: string): string {
  return title.replace(/^RBI\s+/i, '').replace(/\s+Directions\b.*$/i, '').trim() || title;
}

function cacheName(document: string) {
  return `checklists/${document.replace(/\.pdf$/i, '')}.json`;
}

export function listDirections(): DirectionInfo[] {
  const { chunks } = loadSearchIndex();
  const map = new Map<string, DirectionInfo>();
  for (const c of chunks) {
    const d = map.get(c.document);
    if (d) {
      d.chunks++;
      d.words += c.wordCount || 0;
    } else {
      const title = titleOf(c);
      map.set(c.document, {
        document: c.document,
        title,
        shortTitle: shortTitleOf(title),
        date: c.date,
        entity: c.entity,
        chunks: 1,
        words: c.wordCount || 0,
        hasChecklist: false,
      });
    }
  }
  const list = Array.from(map.values());
  for (const d of list) d.hasChecklist = readJson<Checklist>(cacheName(d.document)) !== null;
  return list.sort((a, b) => a.shortTitle.localeCompare(b.shortTitle));
}

export function chunksOf(document: string): ChunkMetadata[] {
  const { chunks } = loadSearchIndex();
  return chunks.filter((c) => c.document === document);
}

export function getCachedChecklist(document: string): Checklist | null {
  return readJson<Checklist>(cacheName(document));
}

export function allCachedChecklists(): Checklist[] {
  return listDirections()
    .filter((d) => d.hasChecklist)
    .map((d) => getCachedChecklist(d.document))
    .filter((c): c is Checklist => c !== null);
}

const CATEGORIES: Category[] = ['Governance', 'Reporting', 'Lending', 'Customers', 'Risk', 'Capital', 'Registration', 'Other'];
const BATCH_WORDS = 3500;

const COMMON = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'any', 'all', 'each', 'shall', 'must', 'such', 'their', 'its', 'are', 'not', 'into', 'per', 'other']);
function wordingFound(claim: string, text: string): boolean {
  const have = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const want = Array.from(new Set(claim.toLowerCase().match(/[a-z]{4,}/g) ?? [])).filter((w) => !COMMON.has(w));
  if (want.length < 3) return false;
  const stem = (w: string) => w.slice(0, 6);
  const stems = new Set(Array.from(have).map(stem));
  return want.filter((w) => have.has(w) || stems.has(stem(w))).length / want.length >= 0.6;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function extractionPrompt(title: string, batch: ChunkMetadata[], part: number, parts: number): string {
  const body = batch
    .map(
      (c) =>
        `--- CHUNK [ID: ${c.id} | Page ${c.pageRange} | Paragraphs: ${c.paragraphNumbers.join(', ') || 'N/A'}] ---\n${c.contextLine}\n${c.text}`,
    )
    .join('\n\n');
  return `You are a compliance analyst building a complete compliance checklist. Below is part ${part + 1} of ${parts} of an RBI Master Direction. Other parts are handled separately, so cover only this part, and cover all of it.

Go through the text paragraph by paragraph and sub-paragraph by sub-paragraph. List every OBLIGATION it places on the regulated entity: things it must do, must not do, must have (a policy, committee, officer, system, limit), or must report, disclose or file.

Rules:
- Every paragraph or sub-paragraph that imposes a requirement gets at least one item. Do not merge requirements from different paragraphs, and keep sub-paragraphs with different requirements as separate items.
- Skip only definitions, background, and statements about what the RBI itself will do.
- Use the chapter heading in each chunk's first line to work out who a rule applies to (for example a chapter for Middle and Upper Layer NBFCs).
- "obligation": one plain-English sentence starting with a verb, under 25 words (for example "Put in place a Board-approved policy on ...").
- "detail": the key thresholds, numbers, exceptions or conditions, in plain English, under 35 words. Keep exact numbers. Empty string if none.
- "para": the paragraph number exactly as numbered in the text, with the sub-paragraph if the item comes from one (for example "13", "25(2)" or "38A").
- "chunkId": the ID of the chunk that contains that paragraph.
- "page": the page shown for that chunk.
- "appliesTo": who it applies to in plain words, from the text (for example "All NBFCs", "Middle and Upper Layer NBFCs", "Deposit-taking NBFCs", "HFCs").
- "layers": the Scale Based Regulation layers it is limited to, from ["base","middle","upper","top"]; an empty list if the text does not limit it to particular layers.
- "deposits": "yes" if only for deposit-taking entities, "no" if only for non-deposit-taking, otherwise "any".
- "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')}.
- "timing": {"kind": "periodic" | "deadline" | "event" | "ongoing", "frequency": "monthly" | "quarterly" | "half-yearly" | "annual" | "", "due": "<when, in the text's words, e.g. 'within 30 days of the change', 'by June 30 each year'; empty if none>", "trigger": "<the event that starts the clock, if kind is event; else empty>"}.
  Use "periodic" for things done every month/quarter/year, "deadline" for a fixed date or a time limit after a known date, "event" for something due when an event happens (within N days of a change), "ongoing" for continuous requirements.

Return JSON: {"items": [ ...objects with exactly these fields... ]}

DIRECTION: ${title} (part ${part + 1} of ${parts})

${body}`;
}

/** Extracts (or returns the saved) checklist of obligations for one Direction. */
export async function getChecklist(document: string, opts: { refresh?: boolean; apiKey?: string } = {}): Promise<Checklist> {
  if (!opts.refresh) {
    const cached = getCachedChecklist(document);
    if (cached) return cached;
  }
  const chunks = chunksOf(document);
  if (!chunks.length) throw new Error('That Direction is not in the index.');
  const title = titleOf(chunks[0]);

  // Long Directions are read in parts, so the model goes paragraph by paragraph instead of summarising.
  const batches: ChunkMetadata[][] = [];
  let current: ChunkMetadata[] = [];
  let words = 0;
  for (const c of chunks) {
    if (current.length && words + (c.wordCount || 0) > BATCH_WORDS) {
      batches.push(current);
      current = [];
      words = 0;
    }
    current.push(c);
    words += c.wordCount || 0;
  }
  if (current.length) batches.push(current);

  const results = await mapLimit(batches, 2, (batch, i) =>
    generateJson<{ items?: Partial<Obligation>[] }>(extractionPrompt(title, batch, i, batches.length), {
      apiKey: opts.apiKey,
      thinking: 'low',
      maxOutputTokens: 32768,
    }),
  );
  const model = results[0]?.model ?? '';
  const raw = results.flatMap((r) => r.data.items ?? []);
  const seen = new Set<string>();
  const data = {
    items: raw.filter((it) => {
      const key = `${String(it?.para ?? '').trim()}|${String(it?.obligation ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };

  const byId = new Map(chunks.map((c) => [c.id, c]));
  const items: Obligation[] = (data.items ?? [])
    .filter((it) => it && typeof it.obligation === 'string' && it.obligation.trim())
    .map((it, i) => {
      const para = String(it.para ?? '').trim();
      let chunk = it.chunkId ? byId.get(String(it.chunkId)) : undefined;
      // Check the citation in code: the paragraph must exist in the stated chunk, or somewhere in this Direction.
      if (!chunk || (para && !chunkHasPara(chunk, para.match(/^(\d+[A-Za-z]?)/)?.[1] ?? para))) {
        chunk = chunks.find((c) => para && chunkHasPara(c, para.match(/^(\d+[A-Za-z]?)/)?.[1] ?? para)) ?? chunk;
      }
      // Annex items have no paragraph number to check, so check that the cited chunk carries the item's wording.
      const isAnnex = /^Annex/i.test(para);
      const verified = isAnnex
        ? !!chunk && wordingFound(`${it.obligation} ${it.detail ?? ''}`, chunk.text)
        : !!chunk && !!para && chunkHasPara(chunk, para.match(/^(\d+[A-Za-z]?)/)?.[1] ?? para);
      const t = (it.timing ?? {}) as Partial<Timing>;
      const kind = ['periodic', 'deadline', 'event', 'ongoing'].includes(String(t.kind)) ? (t.kind as Timing['kind']) : 'ongoing';
      const freq = ['monthly', 'quarterly', 'half-yearly', 'annual'].includes(String(t.frequency)) ? (t.frequency as Timing['frequency']) : '';
      const layers = Array.isArray(it.layers)
        ? (it.layers.filter((l) => ['base', 'middle', 'upper', 'top'].includes(String(l))) as Obligation['layers'])
        : [];
      return {
        id: `${document.replace(/\.pdf$/i, '')}#${i + 1}`,
        obligation: it.obligation!.trim(),
        detail: String(it.detail ?? '').trim(),
        para,
        chunkId: chunk?.id ?? '',
        page: chunk?.pageRange ?? String(it.page ?? ''),
        appliesTo: String(it.appliesTo ?? '').trim() || 'Not specified',
        layers,
        deposits: it.deposits === 'yes' || it.deposits === 'no' ? it.deposits : 'any',
        category: CATEGORIES.includes(it.category as Category) ? (it.category as Category) : 'Other',
        timing: { kind, frequency: freq, due: String(t.due ?? '').trim(), trigger: String(t.trigger ?? '').trim() },
        verified,
      };
    });

  // Coverage, checked in code: which numbered paragraphs produced at least one item.
  const allParas = Array.from(new Set(chunks.flatMap((c) => c.paragraphNumbers ?? []))).filter((p) => /^\d+[A-Za-z]?$/.test(p));
  const used = new Set(items.filter((it) => it.verified).map((it) => it.para.match(/^(\d+[A-Za-z]?)/)?.[1] ?? it.para));
  const coverage = {
    paragraphs: allParas.length,
    withItems: allParas.filter((p) => used.has(p)).length,
    without: allParas.filter((p) => !used.has(p)),
  };

  const checklist: Checklist = {
    document,
    title,
    date: chunks[0].date,
    entity: chunks[0].entity,
    generatedAt: new Date().toISOString(),
    model,
    items,
    coverage,
  };
  writeJson(cacheName(document), checklist);
  return checklist;
}

/** The chunks referenced by a set of obligations, trimmed for the browser (for opening sources). */
export function chunksFor(items: Obligation[]) {
  const { chunks } = loadSearchIndex();
  const ids = new Set(items.map((i) => i.chunkId).filter(Boolean));
  const out: Record<string, unknown> = {};
  for (const c of chunks) {
    if (!ids.has(c.id)) continue;
    out[c.id] = {
      id: c.id,
      document: c.document,
      contextLine: c.contextLine,
      chapter: c.chapter,
      sections: c.sections ?? [],
      pageRange: c.pageRange,
      paragraphNumbers: c.paragraphNumbers ?? [],
      date: c.date,
      entity: c.entity,
      text: c.text,
    };
  }
  return out;
}
