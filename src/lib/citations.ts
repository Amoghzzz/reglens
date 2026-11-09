import type { ChunkMetadata, SearchResult } from './search';
import { citedParagraphs } from './paraList';

/** Citation parsing and checking: a citation counts only if a retrieved passage from the SAME Direction contains the cited paragraph. */

export interface Citation {
  raw: string;
  documentTitle: string;
  paragraph: string;
  page: string;
  verified: boolean;
  matchingChunkId?: string;
}

/** Normalises a Direction title so "RBI Credit Facilities Directions for NBFCs (updated 15 Jul 2026)" matches "Credit Facilities". */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(rbi|reserve bank of india|master|directions?|for|nbfcs?|non-banking financial compan(y|ies)|the|of|and|on)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function titlesMatch(a: string, b: string): boolean {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function chunkTitle(chunk: ChunkMetadata): string {
  return chunk.contextLine.split('>')[0].replace(/[\[\]]/g, '').trim();
}

/** True if the chunk contains numbered paragraph `para` (e.g. "61" or "13A"), either in metadata or as a line starting "61." */
export function chunkHasPara(chunk: ChunkMetadata, para: string): boolean {
  const p = para.toLowerCase();
  if (chunk.paragraphNumbers.some((n) => n.toLowerCase() === p)) return true;
  const esc = para.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)\\s*(?:\\d+\\[)?${esc}\\]?\\.\\s`, 'i').test(chunk.text);
}

/**
 * Checks every citation in the answer against the retrieved chunks.
 * A citation is verified only if a retrieved chunk from the SAME Direction contains the cited paragraph,
 * so "para 61" of one Direction can never be verified against "para 61" of another.
 */
export function verifyCitations(answer: string, retrieved: SearchResult[]): {
  citations: Citation[];
  unverifiedCitations: Citation[];
} {
  const citations: Citation[] = [];
  const unverifiedCitations: Citation[] = [];

  const bracketRegex = /\[([^\]]*?para(?:graph)?\s*[^\]]+?)\]/gi;
  for (const bm of answer.matchAll(bracketRegex)) {
    const parts = bm[1].split(';').map((p) => p.trim());
    let currentDocTitle = '';

    for (const part of parts) {
      const paraIndex = part.search(/para(?:graph)?\s*/i);
      if (paraIndex > 0) {
        const potentialTitle = part.substring(0, paraIndex).replace(/,\s*$/, '').trim();
        if (potentialTitle) currentDocTitle = potentialTitle;
      }

      const paras = citedParagraphs(part);
      if (!paras.length) continue;

      const pageMatch = part.match(/pages?\s*([0-9\-\s]+)/i);
      const page = pageMatch ? pageMatch[1].trim() : '';

      for (const paragraph of paras) {
        const basePara = paragraph.match(/^([0-9]+[A-Za-z]?)/)?.[1] ?? paragraph;
        const withPara = retrieved.filter((r) => chunkHasPara(r.chunk, basePara));
        let match: SearchResult | undefined;
        if (currentDocTitle) {
          match = withPara.find((r) => titlesMatch(chunkTitle(r.chunk), currentDocTitle));
        } else if (withPara.length === 1) {
          match = withPara[0];
        }

        const citation: Citation = {
          raw: `[${currentDocTitle ? currentDocTitle + ', ' : ''}para ${paragraph}${page ? ', page ' + page : ''}]`,
          documentTitle: match ? chunkTitle(match.chunk) : currentDocTitle || 'RBI Directions',
          paragraph,
          page: page || (match ? match.chunk.pageRange : 'unknown'),
          verified: !!match,
          matchingChunkId: match?.chunk.id,
        };
        (match ? citations : unverifiedCitations).push(citation);
      }
    }
  }

  return { citations, unverifiedCitations };
}

/** The lines of a chunk that make up numbered paragraph `para` (from "61." up to the next numbered paragraph or heading). */
export function paragraphText(chunk: ChunkMetadata, para: string, maxChars = 1800): string {
  const base = para.match(/^(\d+[A-Za-z]?)/)?.[1] ?? para;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^\\s*(?:\\d+\\[)?${esc}\\]?\\.\\s`, 'i');
  const nextPara = /^\s*(?:\d+\[)?\d+[A-Za-z]?\]?\.\s/;
  const stop = /^\s*(?:Chapter\b|[A-Z]\.\s|\[Footnote)/;
  const lines = chunk.text.split('\n');
  const out: string[] = [];
  let on = false;
  for (const line of lines) {
    if (start.test(line)) {
      on = true;
      out.push(line);
      continue;
    }
    if (on && (nextPara.test(line) || stop.test(line))) break;
    if (on) out.push(line);
  }
  const text = (out.length ? out : lines).join('\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** Splits an answer into cited statements: each sentence or bullet together with the citations it carries. */
export function citedStatements(answer: string): { statement: string; citations: string[] }[] {
  const out: { statement: string; citations: string[] }[] = [];
  const pieces = answer.split(/\n+/).flatMap((line) => line.split(/(?<=\])\s*(?=[A-Z])|(?<=[.;])\s+(?=[A-Z])/));
  for (const piece of pieces) {
    const cites = piece.match(/\[[^\]\n]*?para(?:graph)?s?\s*[^\]\n]+?\]/gi) ?? [];
    if (!cites.length) continue;
    const statement = piece
      .replace(/\[[^\]\n]*?para(?:graph)?s?\s*[^\]\n]+?\]/gi, '')
      .replace(/^[\s*\-•#]+/, '')
      .replace(/\*\*/g, '')
      .replace(/\s+([.,;:])/g, '$1')
      .trim();
    if (statement.length > 3) out.push({ statement, citations: cites });
  }
  return out;
}
