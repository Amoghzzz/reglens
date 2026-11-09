// Shared by the server and the browser (no imports).

const TOKEN = String.raw`\d+[A-Za-z]?(?:\([0-9A-Za-z]+\))*`;
const LIST_RE = new RegExp(
  String.raw`para(?:graph)?s?\.?\s*(${TOKEN}(?:\s*(?:&|and|,|-|–|to)\s*${TOKEN})*)`,
  'i',
);
const SINGLE_RE = /para(?:graph)?s?\.?\s*([0-9A-Za-z]+(?:\([0-9A-Za-z]+\))?)/i;

/**
 * The paragraphs one citation part refers to: "para 13" -> ["13"], "paras 13 & 14" -> ["13", "14"],
 * "para 13-15" -> ["13", "14", "15"], "para 25(1) and 25(2)" -> ["25(1)", "25(2)"]. Annex-style references
 * such as "para V" are returned as they are.
 */
export function citedParagraphs(part: string): string[] {
  const m = part.match(LIST_RE);
  if (!m) {
    const single = part.match(SINGLE_RE);
    return single ? [single[1]] : [];
  }
  const out: string[] = [];
  const pieces = m[1].split(/\s*(&|and|,|-|–|to)\s*/i);
  for (let i = 0; i < pieces.length; i += 2) {
    const token = pieces[i];
    const sep = pieces[i - 1];
    const prev = out[out.length - 1];
    // A range of plain numbers ("13-15") is expanded; anything else keeps its endpoints.
    if (sep && /^(-|–|to)$/i.test(sep) && prev && /^\d+$/.test(prev) && /^\d+$/.test(token)) {
      const from = Number(prev);
      const to = Number(token);
      if (to > from && to - from <= 8) {
        for (let n = from + 1; n <= to; n++) out.push(String(n));
        continue;
      }
    }
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}
