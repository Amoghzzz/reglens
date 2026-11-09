/**
 * Turns an RBI Master Direction web page (rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=...) into plain text
 * lines in the shape the chunker expects: "Chapter-I ...", "A. Heading", "12. Paragraph ...", "(1) Sub-paragraph",
 * and footnotes as "1 Inserted vide ...". Annexes are separate PDFs on rbidocs.rbi.org.in and are not included.
 */

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  rupee: '₹',
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** The block holding the Direction itself: from the content row to the start of the page's side menus. */
export function directionBody(html: string): string {
  const start = html.indexOf('class="tablecontent2"');
  if (start < 0) throw new Error('Direction text not found on the page (no "tablecontent2" block). The layout may have changed.');
  const open = html.indexOf('>', start) + 1;
  let end = html.indexOf('class="grid_1 archives', open);
  if (end > open) end = html.lastIndexOf('<', end); // cut before the tag that holds the marker
  return html.slice(open, end > open ? end : undefined);
}

/** One line per table row, with non-empty cells joined by " | ". */
function tableToLines(table: string): string {
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map((row) => {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [])
        .map((c) => decode(c.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return cells.join(' | ');
    })
    .filter(Boolean)
    .map((l) => `<p>${l.replace(/</g, '‹')}</p>`)
    .join('\n');
}

export function rbiHtmlToText(html: string): string {
  let b = directionBody(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Drop the table of contents (the first table, made of links to sections and annex PDFs).
  b = b.replace(/<table[^>]*>\s*<tr>\s*<td[^>]*>\s*Table of Contents[\s\S]*?<\/table>/i, ' ');
  // Drop the "Previous Versions" link and the PDF link row.
  b = b.replace(/<a[^>]*NotificationPreVersion[^>]*>[\s\S]*?<\/a>/gi, ' ');

  // Footnotes at the end: <p class="footnote"><a id="F1"></a><sup>1</sup> Inserted vide ...  ->  "1 Inserted vide ..."
  b = b.replace(/(<p[^>]*class="footnote"[^>]*>(?:\s*<a[^>]*><\/a>)?)\s*<sup>\s*(\d+)\s*<\/sup>\s*/gi, '$1$2 ');
  // Inline footnote markers inside paragraphs are dropped (the footnote text itself is kept above).
  b = b.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');

  // Innermost data tables become "cell | cell" lines. Repeat for tables nested inside other tables.
  for (let i = 0; i < 5; i++) {
    const next = b.replace(/<table[^>]*>(?:(?!<table)[\s\S])*?<\/table>/gi, (t) =>
      /<table[^>]*class="(?:td|tablebg)"[^>]*>/i.test(t) && /<p\b/i.test(t) ? t : tableToLines(t),
    );
    if (next === b) break;
    b = next;
  }

  const text = decode(
    b
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<(p|div|tr|li|h[1-6]|table|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/‹/g, '<');

  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l && !/^\(?\d+ kb\)?$/i.test(l))
    .join('\n');
}

/** Fetched text is stored in docs/ as a .txt file whose first line names the page it came from. */
export const SOURCE_PREFIX = 'Source: ';

export function withSourceLine(url: string, text: string): string {
  return `${SOURCE_PREFIX}${url}\n\n${text}\n`;
}

export function splitSourceLine(file: string): { url?: string; text: string } {
  if (!file.startsWith(SOURCE_PREFIX)) return { text: file };
  const nl = file.indexOf('\n');
  return { url: file.slice(SOURCE_PREFIX.length, nl).trim(), text: file.slice(nl + 1).trim() };
}

// Footnote markers that PDF extraction glues onto the next word ("1Reserve Bank", "3[“Owned Fund").
const stripMarkers = (s: string) => s.replace(/(^|[\s(\[])\d{1,2}(?=[A-Z\[“"‘])/g, '$1');
const norm = (s: string) => stripMarkers(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const FOOTNOTE_LINE = /^\d{1,3}\s+(Inserted|Deleted|Substituted|Amended|Omitted|Modified|Added|Renumbered)\b/i;

/**
 * Lines of `next` (at least 30 letters long) that do not appear anywhere in `previous`. Comparison ignores
 * spacing, punctuation, line breaks and footnote markers, so a PDF and the web text of the same Direction
 * compare as equal; numbers are still compared exactly. Footnote lines are skipped (an amendment they record
 * also changes the paragraph itself), and table rows ("a | b | c") are matched cell by cell, since PDFs wrap cells.
 */
export function changedLines(previous: string, next: string): string[] {
  const hay = norm(previous);
  return next
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !FOOTNOTE_LINE.test(l))
    .filter((l) => {
      if (l.includes(' | ')) {
        // Cells, and bullet items within cells, since PDFs wrap both.
        const cells = l
          .split(/ \| |•/)
          .map(norm)
          .filter((c) => c.length >= 12);
        return cells.some((c) => !hay.includes(c));
      }
      const n = norm(l);
      return n.length >= 30 && !hay.includes(n);
    });
}
