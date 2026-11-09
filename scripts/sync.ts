/**
 * RegLens document sync: keeps docs/ in step with the RBI's Master Directions.
 *
 *   npm run sync                 check the RBI list and fetch Directions whose text changed
 *   npm run sync -- --dry-run    report only, change nothing
 *   npm run sync -- --add-new    also fetch NBFC-family Directions RegLens does not cover yet (max 5 a run)
 *
 * The RBI's PDF server blocks scripts, so Directions are read from their web page on rbi.org.in (same text,
 * no page numbers, annexes excluded) and stored as docs/<name>.txt with a "Source:" first line. A Direction is
 * replaced only when its text actually differs; the old file moves to docs/superseded/. A summary is written to
 * data/sync/report.md, and in GitHub Actions `changed=true|false` goes to $GITHUB_OUTPUT.
 */
import fs from 'fs';
import path from 'path';
import { BROWSER_HEADERS, fetchRbiList, parseRbiList, similarity, type RbiEntry } from '../src/lib/updates';
import { changedLines, rbiHtmlToText, splitSourceLine, withSourceLine } from '../src/lib/rbiHtml';
import { extractCleanContinuousLines, extractPages } from './ingest';

const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'docs');
const SUPERSEDED = path.join(DOCS, 'superseded');
const REPORT_DIR = path.join(ROOT, 'data', 'sync');
// file name -> latest RBI version date whose text was confirmed identical to that file
const VERIFIED_FILE = path.join(REPORT_DIR, 'verified.json');

function readVerified(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const addNew = args.includes('--add-new');
const maxNew = Number(args.find((a) => a.startsWith('--max-new='))?.split('=')[1] ?? 5);

const ENTITY_NAMES: Record<string, string> = {
  NBFC: 'Non-Banking Financial Companies',
  HFC: 'Housing Finance Companies',
  CIC: 'Core Investment Companies',
  MGC: 'Mortgage Guarantee Companies',
  SPD: 'Standalone Primary Dealers',
  NOFHC: 'Non-Operative Financial Holding Company',
};

export interface LocalDoc {
  file: string;
  entity: string;
  subject: string; // words, e.g. "Concentration Risk Management"
  date: string;
}

type Action =
  | { kind: 'updated'; entry: RbiEntry; from: LocalDoc; file: string; changes: string[] }
  | { kind: 'same-text'; entry: RbiEntry; doc: LocalDoc }
  | { kind: 'added'; entry: RbiEntry; file: string }
  | { kind: 'failed'; entry: RbiEntry; reason: string };

export function pascalWords(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function localDocs(): LocalDoc[] {
  return fs
    .readdirSync(DOCS)
    .filter((f) => /\.(pdf|txt)$/i.test(f))
    .map((file) => {
      const m = file.match(/^RBI_([A-Z]+)_(.+)_(\d{4}-\d{2}-\d{2})\.(pdf|txt)$/i);
      return m ? { file, entity: m[1].toUpperCase(), subject: pascalWords(m[2]), date: m[3] } : null;
    })
    .filter((d): d is LocalDoc => d !== null);
}

export function fileNameFor(entry: RbiEntry, ext = 'txt'): string {
  const words = (entry.subject || ENTITY_NAMES[entry.entity] || entry.entity)
    .replace(/[’'`]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return `RBI_${entry.entity}_${words.join('')}_${entry.date}.${ext}`;
}

/** The local document an RBI entry corresponds to, if any (same rules as the in-app update check). */
export function matchDoc(entry: RbiEntry, docs: LocalDoc[]): LocalDoc | undefined {
  let best: LocalDoc | undefined;
  let bestScore = 0;
  for (const d of docs) {
    const score =
      d.entity === entry.entity
        ? entry.entity === 'NBFC'
          ? similarity(d.subject, entry.subject)
          : entry.subject
            ? similarity(d.subject, entry.subject)
            : 1
        : entry.entity === 'NBFC' && d.entity !== 'NBFC'
          ? similarity(d.subject, entry.subject)
          : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return bestScore >= 0.6 ? best : undefined;
}

/** Node hides the real network error behind "fetch failed"; dig out its code and message. */
function describeCause(err: unknown): string {
  const parts: string[] = [];
  let c: any = (err as any)?.cause;
  for (let i = 0; c && i < 4; i++, c = c.cause) parts.push([c.code, c.message].filter(Boolean).join(' '));
  return parts.join(' <- ') || 'no further detail';
}

/** The Direction's full text from its rbi.org.in page, with retries. */
async function fetchDirectionText(url: string): Promise<string> {
  let lastError = new Error('fetch failed');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const text = rbiHtmlToText(await res.text());
      const paras = (text.match(/^\d+[A-Z]?\.\s/gm) ?? []).length;
      if (text.split(/\s+/).length < 300 || paras < 3) {
        throw new Error(`the page has too little Direction text (${text.split(/\s+/).length} words, ${paras} paragraphs)`);
      }
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message === 'fetch failed') lastError = new Error(`fetch failed: ${describeCause(lastError)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastError;
}

async function localText(doc: LocalDoc): Promise<string> {
  const full = path.join(DOCS, doc.file);
  if (doc.file.toLowerCase().endsWith('.txt')) return splitSourceLine(fs.readFileSync(full, 'utf8')).text;
  // Same cleaning as the indexer: drops page numbers and running headers/footers, which otherwise land in the
  // middle of any paragraph that crosses a page break and make it look changed.
  return extractCleanContinuousLines(await extractPages(full))
    .map((l) => l.text)
    .join('\n');
}

function writeOutput(changed: boolean) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

function report(actions: Action[], entries: RbiEntry[], current: number, notCovered: RbiEntry[]): string {
  const day = new Date().toISOString().slice(0, 10);
  const lines = [`# RBI sync, ${day}`, ''];
  const of = <K extends Action['kind']>(k: K) => actions.filter((a) => a.kind === k) as Extract<Action, { kind: K }>[];
  const updated = of('updated');
  const added = of('added');
  const same = of('same-text');
  const failed = of('failed');
  lines.push(`Checked ${entries.length} NBFC-family Master Directions on the RBI site. ${current} already match RegLens.`, '');
  if (updated.length) {
    lines.push('## Updated', '');
    for (const a of updated) {
      lines.push(`- **${a.from.subject}**: ${a.from.date} → ${a.entry.date}, ${a.changes.length} changed or new lines ([RBI page](${a.entry.url}))`);
      for (const c of a.changes.slice(0, 5)) lines.push(`  - "${c.length > 220 ? `${c.slice(0, 220)}…` : c}"`);
      if (a.changes.length > 5) lines.push(`  - …and ${a.changes.length - 5} more`);
    }
    lines.push('');
  }
  if (added.length) {
    lines.push('## Added', '');
    for (const a of added) lines.push(`- **${a.entry.subject || a.entry.title}** (${a.entry.date}, [RBI page](${a.entry.url}))`);
    lines.push('');
  }
  if (same.length) {
    lines.push('## Listed under a later date, text unchanged', '');
    for (const a of same) lines.push(`- ${a.doc.subject} (RBI lists ${a.entry.date}; RegLens has ${a.doc.date})`);
    lines.push('');
  }
  if (failed.length) {
    lines.push('## Could not check', '');
    for (const a of failed) lines.push(`- ${a.entry.subject || a.entry.title}: ${a.reason}`);
    lines.push('');
  }
  if (notCovered.length) {
    lines.push(`## On the RBI site but not in RegLens (${notCovered.length})`, '');
    for (const e of notCovered) lines.push(`- ${e.subject || e.title} (${e.date})`);
    lines.push('', 'Run the sync with `--add-new` (or tick "add new" when running the workflow) to add these.', '');
  }
  if (updated.length || added.length) {
    lines.push(
      '## Before merging',
      '',
      '- Updated and added Directions come from their rbi.org.in web page: same text as the PDF, cited by paragraph (no page numbers), annexes not included.',
      '- Spot-check one or two answers on the preview deployment.',
      '',
    );
  }
  return lines.join('\n');
}

async function main() {
  console.log(`\nRegLens sync${dryRun ? ' (dry run)' : ''}${addNew ? `, adding up to ${maxNew} new Directions` : ''}\n`);
  const entries = parseRbiList(await fetchRbiList(45_000));
  if (!entries.length) throw new Error('No NBFC Master Directions found on the RBI page. Its layout may have changed.');

  const docs = localDocs();
  const verified = readVerified();
  let verifiedChanged = false;
  const actions: Action[] = [];
  const notCovered: RbiEntry[] = [];
  let current = 0;

  for (const entry of entries) {
    const doc = matchDoc(entry, docs);
    if (!doc) {
      notCovered.push(entry);
      continue;
    }
    const effective = [doc.date, verified[doc.file] ?? ''].sort().pop()!;
    if (entry.date <= effective) {
      current++;
      continue;
    }
    // Listed under a later date: fetch the text and compare, since a re-listing does not always mean new text.
    try {
      const [next, previous] = await Promise.all([fetchDirectionText(entry.url), localText(doc)]);
      const changes = changedLines(previous, next);
      if (!changes.length) {
        actions.push({ kind: 'same-text', entry, doc });
        if (!dryRun) {
          verified[doc.file] = entry.date;
          verifiedChanged = true;
        }
        console.log(`  same text   ${doc.subject} (RBI lists ${entry.date})`);
        continue;
      }
      const file = fileNameFor(entry);
      if (!dryRun) {
        fs.mkdirSync(SUPERSEDED, { recursive: true });
        fs.renameSync(path.join(DOCS, doc.file), path.join(SUPERSEDED, doc.file));
        fs.writeFileSync(path.join(DOCS, file), withSourceLine(entry.url, next));
      }
      actions.push({ kind: 'updated', entry, from: doc, file, changes });
      console.log(`  UPDATED     ${doc.subject}: ${doc.date} -> ${entry.date} (${changes.length} changed lines)`);
    } catch (err) {
      actions.push({ kind: 'failed', entry, reason: (err as Error).message });
      console.log(`  failed      ${doc.subject}: ${(err as Error).message}`);
    }
  }

  if (addNew) {
    for (const entry of notCovered.slice(0, maxNew)) {
      try {
        const text = await fetchDirectionText(entry.url);
        const file = fileNameFor(entry);
        if (!dryRun) fs.writeFileSync(path.join(DOCS, file), withSourceLine(entry.url, text));
        actions.push({ kind: 'added', entry, file });
        console.log(`  ADDED       ${entry.subject || entry.title} (${entry.date})`);
      } catch (err) {
        actions.push({ kind: 'failed', entry, reason: (err as Error).message });
        console.log(`  failed      ${entry.subject || entry.title}: ${(err as Error).message}`);
      }
    }
  }

  const stillMissing = addNew ? notCovered.slice(maxNew) : notCovered;
  const md = report(actions, entries, current, stillMissing);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'report.md'), md);
  fs.writeFileSync(
    path.join(REPORT_DIR, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), dryRun, actions, notCovered: stillMissing }, null, 2),
  );

  if (verifiedChanged) fs.writeFileSync(VERIFIED_FILE, JSON.stringify(verified, null, 2));
  const changed = !dryRun && (verifiedChanged || actions.some((a) => a.kind === 'updated' || a.kind === 'added'));
  writeOutput(changed);
  console.log(`\n${md}`);
  console.log(changed ? 'Documents changed: run `npm run ingest` next.' : 'No document changes.');
}

if (process.argv[1]?.endsWith('sync.ts')) {
  main().catch((err) => {
    console.error('Sync failed:', err?.message ?? err);
    writeOutput(false);
    process.exit(1);
  });
}
