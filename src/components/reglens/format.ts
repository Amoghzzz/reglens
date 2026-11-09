import type { ChunkView, CitationView, ResultView, SupportVerdict, Turn } from './types';
import { citedParagraphs } from '../../lib/paraList';

export const LEGAL_NOTICE = 'Information only, not legal advice.';

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** "[RBI Credit Facilities Directions for NBFCs (updated 15 Jul 2026)] > ..." -> "RBI Credit Facilities Directions for NBFCs (updated 15 Jul 2026)" */
export function docTitleOf(chunk: ChunkView): string {
  return chunk.contextLine.split('>')[0].replace(/[\[\]]/g, '').trim() || chunk.document;
}

/** "RBI Credit Facilities Directions for NBFCs (...)" -> "Credit Facilities" */
export function shortTitle(title: string): string {
  const s = title.replace(/^RBI\s+/i, '').replace(/\s+Directions\b.*$/i, '').trim();
  return s || title;
}

export function paraRange(chunk: ChunkView): string {
  const p = chunk.paragraphNumbers ?? [];
  if (p.length === 0) return '';
  const first = p[0];
  const start = parseInt(first, 10);
  // Metadata can include sub-item numbers like "(2)"; ignore anything below the first paragraph number.
  const later = p.slice(1).filter((n) => Number.isNaN(start) || parseInt(n, 10) > start);
  const last = later.length ? later[later.length - 1] : first;
  return last === first ? `Paragraph ${first}` : `Paragraphs ${first}–${last}`;
}

/** Normalises a Direction title so variants like "(updated 1 Oct 2026)" or "Income Recognition, Asset..." compare equal. */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(rbi|reserve bank of india|master|directions?|for|nbfcs?|the|of|and|on)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titlesMatch(a: string, b: string): boolean {
  const x = normTitle(a);
  const y = normTitle(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-25" -> "25 Aug 2026" */
export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/* ------------------------------- Citations -------------------------------- */

export interface CitationPart {
  title: string;
  para: string;
  page: string;
}

/** Splits "[Title, para 13(1), page 10; para 14, page 10]" or "[Title, para 13 & 14, page 10]" into one part per paragraph. */
export function parseCitation(bracket: string): CitationPart[] {
  const inner = bracket.replace(/^\[/, '').replace(/\]$/, '');
  let title = '';
  const parts: CitationPart[] = [];
  for (const raw of inner.split(';')) {
    const part = raw.trim();
    const idx = part.search(/para(?:graph)?\s*/i);
    if (idx > 0) {
      const t = part.slice(0, idx).replace(/,\s*$/, '').trim();
      if (t) title = t;
    }
    const paras = citedParagraphs(part);
    if (!paras.length) continue;
    const pg = part.match(/pages?\s*([0-9][0-9\-–\s]*)/i);
    for (const para of paras) parts.push({ title, para, page: pg ? pg[1].trim() : '' });
  }
  return parts;
}

/** Finds the server's verification result for one cited paragraph. */
export function findCitation(turn: Turn, part: CitationPart): CitationView | undefined {
  const all = [...turn.citations, ...turn.unverified];
  const same = all.filter((c) => c.paragraph.toLowerCase() === part.para.toLowerCase());
  if (same.length === 0) return undefined;
  if (part.title) return same.find((c) => titlesMatch(c.documentTitle, part.title));
  return same.length === 1 ? same[0] : undefined;
}

/* ------------------------------ Answer layout ------------------------------ */

// Matches citations like "[RBI ... Directions for NBFCs, para 13(1), page 10]" and **bold** text.
const INLINE_RE = /(\[[^\]\n]*?para(?:graph)?s?\s*[^\]\n]*?\]|\*\*[^*\n]+\*\*)/gi;

export type Segment =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'cite'; parts: CitationPart[] };

export function segments(line: string): Segment[] {
  const out: Segment[] = [];
  for (const piece of line.split(INLINE_RE)) {
    if (!piece) continue;
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      out.push({ t: 'bold', v: piece.slice(2, -2) });
    } else if (piece.startsWith('[') && piece.endsWith(']')) {
      const parts = parseCitation(piece);
      out.push(parts.length ? { t: 'cite', parts } : { t: 'text', v: piece });
    } else {
      out.push({ t: 'text', v: piece });
    }
  }
  return out;
}

export type Section = 'short' | 'applies' | 'details' | 'exceptions' | 'terms' | 'other' | null;

export type Block = { kind: 'p' | 'h' | 'ul' | 'ol'; lines: string[]; section: Section };

function sectionOf(heading: string): Section {
  const h = heading.toLowerCase();
  if (h.startsWith('short answer')) return 'short';
  if (h.startsWith('does this apply') || h.startsWith('applies to you') || h.startsWith('for your')) return 'applies';
  if (h.startsWith('detail')) return 'details';
  if (h.startsWith('exception') || h.startsWith('condition')) return 'exceptions';
  if (h.startsWith('terms') || h.startsWith('key terms')) return 'terms';
  return 'other';
}

/** Turns the model's markdown-ish answer into headed sections of paragraphs and lists. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: Block | null = null;
  let section: Section = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[*\-•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        list = { kind, lines: [], section };
        blocks.push(list);
      }
      list.lines.push((bullet ?? numbered)![1]);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const allBold = line.trim().match(/^\*\*([^*]+)\*\*:?$/);
    if (heading || allBold) {
      const title = (heading ? heading[1] : allBold![1]).replace(/\*\*/g, '').replace(/:$/, '').trim();
      if (heading) section = sectionOf(title);
      blocks.push({ kind: 'h', lines: [title], section: heading ? section : section });
    } else {
      blocks.push({ kind: 'p', lines: [line], section });
    }
  }
  return blocks;
}

/** "Applies: rule..." -> { kind: 'applies', text: 'rule...' } for the "Does this apply to you?" section. */
export function splitApplies(line: string): { kind: 'applies' | 'not' | 'depends'; text: string } | null {
  const m = line.replace(/^\*\*/, '').match(/^(Applies|Does not apply|Doesn't apply|Depends)\s*:?\**\s*:?\s*(.*)$/i);
  if (!m) return null;
  const k = m[1].toLowerCase();
  return { kind: k.startsWith('applies') ? 'applies' : k.startsWith('depends') ? 'depends' : 'not', text: m[2] };
}

/** "**Tier 1 capital**: the core capital..." -> { term, meaning } */
export function splitTerm(line: string): { term: string; meaning: string } | null {
  const m = line.match(/^\*\*([^*]+)\*\*\s*[:\-–]\s*(.*)$/) ?? line.match(/^([^:]{2,40}):\s+(.*)$/);
  return m ? { term: m[1].replace(/:$/, '').trim(), meaning: m[2].trim() } : null;
}

export function noteKey(part: CitationPart): string {
  return `${normTitle(part.title)}|${part.para.toLowerCase()}`;
}

export interface Note {
  n: number;
  /** Claim-level check: the weakest verdict across the sentences that cite this paragraph. */
  support?: { verdict: SupportVerdict; reason: string };
  part: CitationPart;
  citation?: CitationView;
  result?: ResultView;
  verified: boolean;
  title: string;
  page: string;
  excerpt: string;
}

/**
 * Numbers each distinct citation in order of first appearance and attaches it to the block
 * where it first appears, so notes can sit in the margin beside the text they support.
 */
export function buildNotes(blocks: Block[], turn: Turn) {
  const keyToN = new Map<string, number>();
  const notes: Note[] = [];
  const notesByBlock: number[][] = blocks.map(() => []);
  const done = turn.status === 'done';

  blocks.forEach((block, bi) => {
    for (const line of block.lines) {
      for (const seg of segments(line)) {
        if (seg.t !== 'cite') continue;
        for (const part of seg.parts) {
          const key = noteKey(part);
          if (keyToN.has(key)) continue;
          const n = notes.length + 1;
          keyToN.set(key, n);
          const citation = done ? findCitation(turn, part) : undefined;
          const result = citation?.matchingChunkId
            ? turn.results.find((r) => r.chunk.id === citation.matchingChunkId)
            : undefined;
          const verified = Boolean(citation?.verified && result);
          const checks = done && result
            ? (turn.support ?? []).filter(
                (s) => s.chunkId === result.chunk.id && s.paragraph.toLowerCase() === (citation?.paragraph ?? part.para).toLowerCase(),
              )
            : [];
          const worst =
            checks.find((s) => s.verdict === 'unsupported') ??
            checks.find((s) => s.verdict === 'partial') ??
            checks.find((s) => s.verdict === 'supported');
          notes.push({
            n,
            support: worst ? { verdict: worst.verdict, reason: worst.reason } : undefined,
            part,
            citation,
            result,
            verified,
            title: result ? docTitleOf(result.chunk) : part.title || citation?.documentTitle || 'RBI Directions',
            page: part.page || result?.chunk.pageRange || '',
            excerpt: result ? excerptOf(result.chunk.text, citation?.paragraph ?? part.para, stripCitations(line)) : '',
          });
          notesByBlock[bi].push(n);
        }
      }
    }
  });

  return { keyToN, notes, notesByBlock };
}

/* ------------------------------ Source text ------------------------------- */

/**
 * Marks which lines of a chunk belong to the cited paragraph, so they can be highlighted.
 * A paragraph starts at "13. ..." and runs until the next numbered paragraph, a heading, or a footnote.
 */
export function markLines(text: string, paragraph?: string): { line: string; hl: boolean }[] {
  const out = text.split('\n').map((line) => ({ line, hl: false }));
  if (!paragraph) return out;
  const base = paragraph.match(/^(\d+[A-Za-z]?)/)?.[1] ?? paragraph;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^\\s*(?:\\d+\\[)?${esc}\\]?\\.\\s`, 'i');
  const nextPara = /^\s*(?:\d+\[)?\d+[A-Za-z]?\]?\.\s/;
  const stop = /^\s*(?:Chapter\b|[A-Z]\.\s|\[Footnote)/;
  let on = false;
  for (const item of out) {
    if (start.test(item.line)) {
      on = true;
      item.hl = true;
      continue;
    }
    if (on && (nextPara.test(item.line) || stop.test(item.line))) on = false;
    item.hl = on;
  }
  return out;
}

function stripCitations(line: string): string {
  return line.replace(/\[[^\]\n]*\]/g, ' ').replace(/\*\*/g, '');
}

const STOP = new Set(
  'the and for with that this from shall have has are was not any its their such which under than into other also may can must will been per'.split(' '),
);

function terms(text: string): Set<string> {
  const words = text.toLowerCase().replace(/,/g, '').match(/[a-z0-9₹.]+/g) ?? [];
  return new Set(
    words
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)),
  );
}

/**
 * A short quote from the cited paragraph for the margin note.
 * Picks the sentence or list item that best matches the claim it supports, rather than the paragraph's opening.
 */
export function excerptOf(text: string, paragraph: string, claim = '', max = 240): string {
  const quoted = markLines(text, paragraph)
    .filter((l) => l.hl)
    .map((l) => l.line)
    .join(' ')
    .replace(/^\s*(?:\d+\[)?\d+[A-Za-z]?\]?\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!quoted) return '';

  const units = quoted
    .split(/(?<=[.;:,])\s+(?=(?:[A-Z]|\(\d+\)|\([ivx]+\)|\([a-z]\)))|\s+(?=\((?:\d+|[ivx]+|[a-z])\)\s)/)
    .filter(Boolean);
  let best = 0;
  // A citation to a sub-paragraph such as 25(2) quotes that sub-paragraph, not the paragraph's opening.
  const sub = paragraph.match(/^\s*\d+[A-Za-z]?\s*\(([^)]+)\)/)?.[1];
  const subIndex = sub ? units.findIndex((u) => u.startsWith(`(${sub})`)) : -1;
  if (subIndex >= 0) {
    best = subIndex;
  } else if (claim && units.length > 1) {
    const want = terms(claim);
    let bestScore = -1;
    units.forEach((u, i) => {
      let score = 0;
      for (const t of terms(u)) if (want.has(t)) score += /\d/.test(t) ? 3 : 1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
  }

  let out = units[best];
  if (out.length < 110 && units[best + 1]) out = `${out} ${units[best + 1]}`;
  const lead = best > 0 ? '…' : '';
  if (out.length > max) {
    const cut = out.slice(0, max);
    out = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
  } else if (best + 1 < units.length && !/[.;]$/.test(out)) {
    out = `${out}…`;
  }
  return `${lead}${out}`;
}

export type SourceLineKind = 'heading' | 'para' | 'sub' | 'footnote' | 'text';

/** Classifies a line of RBI text so the source panel can lay it out like the printed Direction. */
export function classifyLine(line: string): { kind: SourceLineKind; num?: string; body: string } {
  if (/^\s*\[Footnote/i.test(line)) return { kind: 'footnote', body: line.trim().replace(/^\[|\]$/g, '') };
  if (/^\s*(?:Chapter\b|[A-Z]\.\s)/.test(line)) return { kind: 'heading', body: line.trim() };
  const para = line.match(/^\s*(?:\d+\[)?(\d+[A-Za-z]?)\]?\.\s+(.*)$/);
  if (para) return { kind: 'para', num: para[1], body: para[2] };
  if (/^\s*\((?:\d+|[ivxlc]+|[a-z])\)\s/i.test(line)) return { kind: 'sub', body: line.trim() };
  return { kind: 'text', body: line.trim() };
}

export function friendlyError(message: string): string {
  if (/429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(message)) {
    return "RegLens has used up its free AI allowance for now. Try again in a few minutes.";
  }
  return message || 'Something went wrong while answering. Try again.';
}
