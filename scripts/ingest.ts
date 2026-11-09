import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EMBEDDING_MODEL_NAME, getEmbeddingModel } from '../src/lib/embeddings';
import { splitSourceLine } from '../src/lib/rbiHtml';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Support both pdf-parse v1 and v2
let PDFParseClass: any = null;
try {
  const pdfModule = require('pdf-parse');
  PDFParseClass = pdfModule.PDFParse || pdfModule.default || pdfModule;
} catch (e) {
  console.error('Failed to load pdf-parse:', e);
}

export interface LineWithPage {
  text: string;
  page: number;
}

export interface Footnote {
  num: string;
  text: string;
}

export interface LogicalUnit {
  type: 'CHAPTER' | 'SECTION' | 'PARA' | 'TEXT';
  chapter: string;
  section: string;
  paraNums: string[];
  lines: LineWithPage[];
  footnotes: Footnote[];
  text: string;
  wordCount: number;
  startPage: number;
  endPage: number;
}

export interface DocumentChunk {
  id: string;
  document: string;
  regulator: string;
  entity: string;
  topic: string;
  date: string;
  startPage: number;
  endPage: number;
  pageRange: string;
  spansPages: boolean;
  paragraphNumbers: string[];
  chapter: string;
  section: string;
  sections: string[];
  contextLine: string;
  text: string;
  textToEmbed: string;
  wordCount: number;
  embedding?: number[];
  /** For Directions read from their rbi.org.in web page (.txt in docs/): the page URL. Such chunks have pageRange "web". */
  sourceUrl?: string;
}

export function formatReadableTitle(filename: string): string {
  const base = path.basename(filename).replace(/\.(pdf|txt)$/i, '');
  const parts = base.split('_');
  if (parts.length < 4) return base;

  const regulator = parts[0];
  const entity = parts[1];
  const dateStr = parts[parts.length - 1];
  const rawTopic = parts.slice(2, parts.length - 1).join(' ');
  const topic = rawTopic
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = dateStr.split('-');
  const formattedDate = `${parseInt(d, 10)} ${monthNames[parseInt(m, 10) - 1]} ${y}`;
  const isUpdated = dateStr !== '2025-11-28';
  const dateLabel = isUpdated ? `updated ${formattedDate}` : `published ${formattedDate}`;

  return `${regulator} ${topic} Directions for ${entity}s (${dateLabel})`;
}

export function isFootnote(line: string): Footnote | null {
  const match = line.match(
    /^(?:\[?(\d{1,3})\]?\s*(Inserted|Deleted|Substituted|Amended|Omitted|Modified|Vide|W\.?e\.?f\.?|With effect from|Refer to|Note:)\b|(\d{1,3})(Inserted|Deleted|Substituted|Amended|Omitted|Modified|Vide|W\.?e\.?f\.?|With effect from)\b)/i
  );
  if (match) {
    const num = match[1] || match[3];
    const text = line.replace(/^(?:\[?\d{1,3}\]?\s*|\d{1,3})/, '').trim();
    return { num, text };
  }
  return null;
}

/**
 * Extracts continuous lines across all pages:
 * Only removes standalone page numbers at top/bottom and lines that appear
 * at the very top or bottom on >30% of pages (true headers/footers).
 * Preserves all legitimate body text.
 */
export function extractCleanContinuousLines(pages: { num: number; text: string }[]): LineWithPage[] {
  const topFreq: Record<string, number> = {};
  const bottomFreq: Record<string, number> = {};

  pages.forEach(p => {
    const raw = (p.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (raw.length > 0) {
      const top = raw[0];
      topFreq[top] = (topFreq[top] || 0) + 1;
      const btm = raw[raw.length - 1];
      bottomFreq[btm] = (bottomFreq[btm] || 0) + 1;
    }
  });

  const threshold = Math.max(3, pages.length * 0.3);
  const repeatedHeaders = new Set(Object.keys(topFreq).filter(k => topFreq[k] >= threshold));
  const repeatedFooters = new Set(Object.keys(bottomFreq).filter(k => bottomFreq[k] >= threshold));

  const cleanLines: LineWithPage[] = [];

  pages.forEach((p, pIdx) => {
    const raw = (p.text || '').split('\n');
    for (let i = 0; i < raw.length; i++) {
      let line = raw[i].replace(/[ \t]+/g, ' ').trim();
      if (!line) continue;

      // 1. Standalone page number (first or last 3 lines)
      if (/^\d+$/.test(line) && (i < 3 || i > raw.length - 4)) continue;

      // 2. Cover banner on Page 1 only
      if (pIdx === 0 && (line.includes('भारतीय') || line.includes('RESERVE BANK OF INDIA')) && i < 3) continue;

      // 3. Repeated header/footer appearing on > 30% of pages at boundary lines
      if (i < 2 && repeatedHeaders.has(line)) continue;
      if (i > raw.length - 3 && repeatedFooters.has(line)) continue;

      // 4. Dot leaders in table of contents
      if (line.includes('......') || line.includes('……')) continue;

      cleanLines.push({ text: line, page: p.num });
    }
  });

  return cleanLines;
}

/**
 * Groups lines into logical units based on RBI structure:
 * Chapter headings, Section headings, Top-level numbered paragraphs
 * with all sub-lists/tables/sub-clauses kept together, and footnotes separated.
 */
export function groupIntoLogicalUnits(lines: LineWithPage[]): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  let currentChapter = '';
  let currentSection = '';
  let currentLines: LineWithPage[] = [];
  let currentParaNums: string[] = [];
  let currentFootnotes: Footnote[] = [];
  let currentType: 'CHAPTER' | 'SECTION' | 'PARA' | 'TEXT' = 'TEXT';

  function flushUnit() {
    if (currentLines.length === 0 && currentFootnotes.length === 0) return;
    const text = currentLines.map(l => l.text).join('\n');
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const startPage = currentLines.length > 0 ? currentLines[0].page : 1;
    const endPage = currentLines.length > 0 ? currentLines[currentLines.length - 1].page : 1;

    units.push({
      type: currentType,
      chapter: currentChapter,
      section: currentSection,
      paraNums: Array.from(new Set(currentParaNums)),
      lines: currentLines,
      footnotes: currentFootnotes,
      text,
      wordCount,
      startPage,
      endPage
    });

    currentLines = [];
    currentParaNums = [];
    currentFootnotes = [];
    currentType = 'TEXT';
  }

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const t = item.text;

    // Separate footnotes from the paragraph body
    const fn = isFootnote(t);
    if (fn) {
      currentFootnotes.push(fn);
      continue;
    }

    // Detect Chapter Heading (e.g. Chapter-I Preliminary, Chapter-II...)
    if (/^Chapter\s*[-–—]?\s*[IVXLCDM\d]+/i.test(t)) {
      flushUnit();
      currentChapter = t;
      currentSection = '';
      currentType = 'CHAPTER';
      currentLines = [item];
      flushUnit();
      continue;
    }

    // Detect Section Heading (e.g. A. Short Title, B. Applicability, C.1 Guidelines...)
    const isSectionHeading =
      /^[A-Z]\.?\d*\.?\s+[-–—]?\s*[A-Za-z]/.test(t) &&
      t.length < 130 &&
      !t.endsWith('.') &&
      !t.endsWith(';') &&
      !t.endsWith(',') &&
      !t.endsWith(':') &&
      !/^(In|The|Any|Act|RBI|As|All|No|It|On|At|For|If|Where|Under|With|From|To)\s/i.test(t);

    if (isSectionHeading) {
      flushUnit();
      currentSection = t;
      currentType = 'SECTION';
      currentLines = [item];
      continue;
    }

    // Detect Top-level Numbered Paragraph (e.g. '1.', '6.', '10.', '36A.', '16[36A.')
    const paraMatch = t.match(/^(?:(?:\d+\[)?(\d+[A-Z]?)(?:\])?)\.\s+/);
    if (paraMatch) {
      flushUnit();
      currentType = 'PARA';
      currentParaNums = [paraMatch[1]];
      currentLines = [item];
      continue;
    }

    // Append to current unit (sub-clauses (1), (i), table row, continuation text)
    currentLines.push(item);
  }

  flushUnit();
  return units;
}

/**
 * Assembles chunks targeting 300-500 words with small overlap.
 * Never crosses chapter boundaries.
 * Stores all section headings covered and attaches footnotes at the end.
 */
export function buildDocumentChunks(units: LogicalUnit[], docName: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const readableDocTitle = formatReadableTitle(docName);
  const baseName = path.basename(docName).replace(/\.(pdf|txt)$/i, '');
  const parts = baseName.split('_');
  const regulator = parts[0] || 'RBI';
  const entity = parts[1] || 'NBFC';
  const date = parts[parts.length - 1] || '2025-11-28';
  const topic = parts.slice(2, parts.length - 1).join('_') || baseName;

  let currentUnits: LogicalUnit[] = [];
  let currentWordCount = 0;
  let chunkIdx = 1;

  function emitChunk(unitList: LogicalUnit[]) {
    if (unitList.length === 0) return;
    const allLines = unitList.flatMap(u => u.lines);
    if (allLines.length === 0) return;

    const startPage = Math.min(...allLines.map(l => l.page));
    const endPage = Math.max(...allLines.map(l => l.page));
    const paraNums = Array.from(new Set(unitList.flatMap(u => u.paraNums)));
    const chapter = unitList[0].chapter || '';

    // Collect ALL sections covered
    const sectionsCovered = Array.from(new Set(unitList.map(u => u.section).filter(Boolean)));
    const sectionStr = sectionsCovered.length > 0 ? sectionsCovered.join('; ') : 'General';

    // Footnotes attached at the end of the chunk
    const allFootnotes = unitList.flatMap(u => u.footnotes || []);
    let bodyText = unitList.map(u => u.text).filter(Boolean).join('\n\n');
    if (allFootnotes.length > 0) {
      const fnBlock = allFootnotes.map(f => `[Footnote ${f.num}: ${f.text}]`).join('\n');
      bodyText = `${bodyText}\n\n${fnBlock}`;
    }

    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const contextLine = `[${readableDocTitle}] > [${chapter || 'General'}] > [${sectionStr}]`;
    const textToEmbed = `${contextLine}\n\n${bodyText}`;

    chunks.push({
      id: `${baseName}_c${chunkIdx++}`,
      document: docName,
      regulator,
      entity,
      topic,
      date,
      startPage,
      endPage,
      pageRange: startPage === endPage ? `${startPage}` : `${startPage}-${endPage}`,
      spansPages: startPage !== endPage,
      paragraphNumbers: paraNums,
      chapter,
      section: sectionStr,
      sections: sectionsCovered,
      contextLine,
      text: bodyText,
      textToEmbed,
      wordCount
    });
  }

  for (let i = 0; i < units.length; i++) {
    const u = units[i];

    // Enforce CHAPTER BOUNDARY: never allow a chunk to cross a chapter
    if (currentUnits.length > 0 && u.chapter !== currentUnits[0].chapter) {
      emitChunk(currentUnits);
      currentUnits = [];
      currentWordCount = 0;
    }

    // Split oversized units > 500 words cleanly
    if (u.wordCount > 500) {
      if (currentUnits.length > 0) {
        emitChunk(currentUnits);
        currentUnits = [];
        currentWordCount = 0;
      }

      let subLines: LineWithPage[] = [];
      let subWordCount = 0;

      for (const item of u.lines) {
        const lineWords = item.text.split(/\s+/).filter(Boolean).length;
        if (subWordCount + lineWords > 450 && subWordCount >= 300) {
          emitChunk([{
            type: u.type,
            chapter: u.chapter,
            section: u.section,
            paraNums: u.paraNums,
            lines: subLines,
            footnotes: [],
            text: subLines.map(l => l.text).join('\n'),
            wordCount: subWordCount,
            startPage: subLines[0].page,
            endPage: subLines[subLines.length - 1].page
          }]);
          subLines = [item];
          subWordCount = lineWords;
        } else {
          subLines.push(item);
          subWordCount += lineWords;
        }
      }

      if (subLines.length > 0) {
        emitChunk([{
          type: u.type,
          chapter: u.chapter,
          section: u.section,
          paraNums: u.paraNums,
          lines: subLines,
          footnotes: u.footnotes,
          text: subLines.map(l => l.text).join('\n'),
          wordCount: subWordCount,
          startPage: subLines[0].page,
          endPage: subLines[subLines.length - 1].page
        }]);
      }
      continue;
    }

    // Normal accumulation: target 300-500 words
    if (currentWordCount + u.wordCount > 500 && currentWordCount >= 280) {
      emitChunk(currentUnits);
      currentUnits = [u];
      currentWordCount = u.wordCount;
    } else {
      currentUnits.push(u);
      currentWordCount += u.wordCount;
    }
  }

  if (currentUnits.length > 0) {
    emitChunk(currentUnits);
  }

  return chunks;
}

export async function extractPages(filePath: string): Promise<{ num: number; text: string }[]> {
  const buffer = fs.readFileSync(filePath);
  if (typeof PDFParseClass === 'function' && PDFParseClass.prototype && PDFParseClass.prototype.getText) {
    const parser = new PDFParseClass({ data: buffer });
    try {
      const res = await parser.getText();
      return (res.pages || []).map((p: any) => ({
        num: p.num,
        text: p.text || ''
      }));
    } finally {
      await parser.destroy();
    }
  } else if (typeof PDFParseClass === 'function') {
    const data = await PDFParseClass(buffer);
    return [{ num: 1, text: data.text || '' }];
  }
  throw new Error('Unsupported pdf-parse interface');
}

export function saveIndexAtomically(outputPath: string, chunks: DocumentChunk[]) {
  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(chunks, null, 2), 'utf8');
  fs.renameSync(tempPath, outputPath);
}

const VECTOR_DIM = 3072;

/** Embeddings from the committed search files (data/chunks.json + data/vectors.bin), keyed by chunk id. */
export function loadCommittedEmbeddings(dataDir: string): Map<string, { text: string; embedding: number[] }> {
  const out = new Map<string, { text: string; embedding: number[] }>();
  const chunksPath = path.join(dataDir, 'chunks.json');
  const vectorsPath = path.join(dataDir, 'vectors.bin');
  if (!fs.existsSync(chunksPath) || !fs.existsSync(vectorsPath)) return out;
  try {
    const chunks: { id: string; textToEmbed: string }[] = JSON.parse(fs.readFileSync(chunksPath, 'utf8'));
    const buf = fs.readFileSync(vectorsPath);
    const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (vectors.length !== chunks.length * VECTOR_DIM) {
      console.warn('data/vectors.bin does not match data/chunks.json; ignoring it.');
      return out;
    }
    chunks.forEach((c, i) => {
      out.set(c.id, { text: c.textToEmbed, embedding: Array.from(vectors.subarray(i * VECTOR_DIM, (i + 1) * VECTOR_DIM)) });
    });
  } catch (e) {
    console.warn('Could not read the committed search files:', e);
  }
  return out;
}

/** Writes the files the app searches: chunk text and metadata (chunks.json) and the embeddings (vectors.bin). */
export function writeSearchFiles(dataDir: string, chunks: DocumentChunk[]) {
  const done = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length === VECTOR_DIM);
  if (done.length !== chunks.length) {
    console.warn(`Not writing search files: ${chunks.length - done.length} chunks have no embedding yet.`);
    return;
  }
  const vectors = new Float32Array(chunks.length * VECTOR_DIM);
  chunks.forEach((c, i) => vectors.set(c.embedding!, i * VECTOR_DIM));
  const meta = chunks.map(({ embedding, ...rest }) => rest);
  const chunksPath = path.join(dataDir, 'chunks.json');
  const vectorsPath = path.join(dataDir, 'vectors.bin');
  fs.writeFileSync(`${chunksPath}.tmp`, JSON.stringify(meta), 'utf8');
  fs.writeFileSync(`${vectorsPath}.tmp`, Buffer.from(vectors.buffer));
  fs.renameSync(`${chunksPath}.tmp`, chunksPath);
  fs.renameSync(`${vectorsPath}.tmp`, vectorsPath);
  console.log(`Search files written: data/chunks.json (${chunks.length} chunks) and data/vectors.bin.`);
}

export function printRandomChunks(chunks: DocumentChunk[], count = 3) {
  console.log(`\n===============================================================`);
  console.log(`  Sample Chunks Inspection (${count} Samples)`);
  console.log(`===============================================================\n`);

  if (chunks.length === 0) {
    console.log(`No chunks available.`);
    return;
  }

  // Find sample 3 (CIC, para 85) specifically
  const cicPara85 = chunks.find(
    c => c.document.includes('CoreInvestmentCompanies') && c.paragraphNumbers.includes('85')
  );

  const selectedSamples: DocumentChunk[] = [];
  if (cicPara85) {
    selectedSamples.push(cicPara85);
  }

  // Find a sample that crosses a page boundary
  const spanningChunks = chunks.filter(c => c.spansPages && !selectedSamples.includes(c));
  if (spanningChunks.length > 0) {
    selectedSamples.push(spanningChunks[Math.floor(Math.random() * spanningChunks.length)]);
  }

  while (selectedSamples.length < count) {
    const randomChunk = chunks[Math.floor(Math.random() * chunks.length)];
    if (!selectedSamples.includes(randomChunk)) {
      selectedSamples.push(randomChunk);
    }
  }

  selectedSamples.forEach((c, i) => {
    console.log(`--- [Sample ${i + 1} / ${count}] Chunk ID: ${c.id} ---`);
    console.log(`Metadata:`);
    console.log(`  Document    : ${c.document}`);
    console.log(`  Regulator   : ${c.regulator}`);
    console.log(`  Entity      : ${c.entity}`);
    console.log(`  Topic       : ${c.topic}`);
    console.log(`  Date        : ${c.date}`);
    console.log(`  Page Range  : ${c.pageRange} (Spans Pages: ${c.spansPages ? 'YES' : 'NO'})`);
    console.log(`  Paragraphs  : ${c.paragraphNumbers.length > 0 ? c.paragraphNumbers.join(', ') : '(intro / sub-clause)'}`);
    console.log(`  Chapter     : ${c.chapter || '(none)'}`);
    console.log(`  Sections    : ${c.sections.length > 0 ? c.sections.join('; ') : '(none)'}`);
    console.log(`  Word Count  : ${c.wordCount} words`);
    console.log(`  Context Line: ${c.contextLine}`);
    console.log(`  Embedding   : ${c.embedding ? `Generated (${c.embedding.length} dim)` : 'Pending'}`);
    console.log(`\nText to Embed (Context + Content):\n${c.textToEmbed}\n`);
    console.log(`---------------------------------------------------------------\n`);
  });
}

export async function embedBatchWithRetry(
  model: any,
  texts: string[],
  maxRetries = 5
): Promise<{ embeddings?: number[][]; dailyQuotaExceeded?: boolean; error?: any }> {
  let attempt = 0;
  while (true) {
    try {
      const res = await model.batchEmbedContents({
        requests: texts.map(t => ({
          content: { role: 'user', parts: [{ text: t }] }
        }))
      });
      return { embeddings: res.embeddings.map((e: any) => e.values) };
    } catch (error: any) {
      attempt++;
      const msg = (error?.message || '').toLowerCase();
      const isDailyQuota =
        msg.includes('daily') ||
        msg.includes('per-day') ||
        msg.includes('quota exceeded for quota metric') ||
        msg.includes('generatecontent requests per day');

      if (isDailyQuota) {
        return { dailyQuotaExceeded: true, error };
      }

      const isRateLimit =
        error?.status === 429 ||
        msg.includes('429') ||
        msg.includes('resource_exhausted') ||
        msg.includes('rate limit');

      if (isRateLimit && attempt <= maxRetries) {
        const waitTimeSec = Math.min(Math.pow(2, attempt) * 5, 60);
        console.warn(
          `\n[Gemini Rate Limit] 429 received. Backing off for ${waitTimeSec}s before retrying (Attempt ${attempt}/${maxRetries})...`
        );
        await new Promise(resolve => setTimeout(resolve, waitTimeSec * 1000));
      } else if (isRateLimit && attempt > maxRetries) {
        return { dailyQuotaExceeded: true, error };
      } else {
        throw error;
      }
    }
  }
}

async function main() {
  const startTime = Date.now();
  const docsDir = path.resolve(process.cwd(), 'docs');
  const dataDir = path.resolve(process.cwd(), 'data');
  const outputPath = path.join(dataDir, 'index.json');

  console.log(`\n===============================================================`);
  console.log(`  RegLens Document Ingestion & Embedding Pipeline`);
  console.log(`  Embedding Model: ${EMBEDDING_MODEL_NAME}`);
  console.log(`===============================================================\n`);

  if (!fs.existsSync(docsDir)) {
    console.error(`Docs directory not found at ${docsDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Check existing index for resumability
  // --plan: chunk everything and report what would need embedding, without calling the API or writing files.
  // --from-committed: ignore data/index.json and reuse embeddings from the committed search files instead.
  const planOnly = process.argv.includes('--plan');
  const fromCommitted = process.argv.includes('--from-committed') || planOnly;
  const existingEmbeddingsMap = new Map<string, number[]>();
  if (!fromCommitted && fs.existsSync(outputPath)) {
    try {
      const existingData: DocumentChunk[] = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      for (const item of existingData) {
        if (item.id && Array.isArray(item.embedding) && item.embedding.length > 0) {
          existingEmbeddingsMap.set(item.id, item.embedding);
        }
      }
      if (existingEmbeddingsMap.size > 0) {
        console.log(`Resuming session: Found ${existingEmbeddingsMap.size} existing embedded chunks in ${outputPath}.\n`);
      }
    } catch (e) {
      console.warn(`Could not parse existing ${outputPath}, building fresh index.`);
    }
  }

  // 1b. No index.json (for example in the scheduled GitHub run): reuse the embeddings in the committed search
  // files, but only for chunks whose text is unchanged, so only new or changed documents use embedding quota.
  const seededText = new Map<string, string>();
  if (existingEmbeddingsMap.size === 0) {
    const seeded = loadCommittedEmbeddings(dataDir);
    for (const [id, { text, embedding }] of seeded) {
      existingEmbeddingsMap.set(id, embedding);
      seededText.set(id, text);
    }
    if (seeded.size > 0) console.log(`Reusing ${seeded.size} embeddings from data/chunks.json and data/vectors.bin.\n`);
  }

  // 2. Read and parse PDFs with continuous text across pages
  const files = fs.readdirSync(docsDir).filter(f => /\.(pdf|txt)$/i.test(f)).sort();
  console.log(`Scanning and chunking ${files.length} PDF documents in /docs...`);

  const allChunks: DocumentChunk[] = [];
  let totalPagesProcessed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(docsDir, file);

    // .txt files are Directions read from their rbi.org.in web page (see scripts/sync.ts): one "page", no numbers.
    const isWeb = file.toLowerCase().endsWith('.txt');
    const web = isWeb ? splitSourceLine(fs.readFileSync(filePath, 'utf8')) : null;
    const pages = web ? [{ num: 1, text: web.text }] : await extractPages(filePath);
    totalPagesProcessed += pages.length;

    const cleanLines = extractCleanContinuousLines(pages);
    const units = groupIntoLogicalUnits(cleanLines);
    const docChunks = buildDocumentChunks(units, file);
    if (web) {
      for (const c of docChunks) {
        c.pageRange = 'web';
        c.spansPages = false;
        if (web.url) c.sourceUrl = web.url;
      }
    }

    // Restore existing embeddings if resuming
    for (const chunk of docChunks) {
      const seededFor = seededText.get(chunk.id);
      if (existingEmbeddingsMap.has(chunk.id) && (seededFor === undefined || seededFor === chunk.textToEmbed)) {
        chunk.embedding = existingEmbeddingsMap.get(chunk.id);
      }
    }

    allChunks.push(...docChunks);
  }

  const completedChunks = allChunks.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0);
  const pendingChunks = allChunks.filter(c => !Array.isArray(c.embedding) || c.embedding.length === 0);
  const spanningChunks = allChunks.filter(c => c.spansPages);

  console.log(`\n===============================================================`);
  console.log(`  Chunking Analysis Summary`);
  console.log(`===============================================================`);
  console.log(`  Total Documents Processed : ${files.length}`);
  console.log(`  Total Pages Processed     : ${totalPagesProcessed}`);
  console.log(`  Total Chunks Generated    : ${allChunks.length}`);
  console.log(`  Chunks Spanning Pages     : ${spanningChunks.length} (${((spanningChunks.length / allChunks.length) * 100).toFixed(1)}%)`);
  console.log(`  Average Chunk Word Count  : ${Math.round(allChunks.reduce((a, c) => a + c.wordCount, 0) / allChunks.length)} words`);
  console.log(`  Already Embedded          : ${completedChunks.length}`);
  console.log(`  Pending Embedding         : ${pendingChunks.length}`);
  console.log(`===============================================================\n`);

  if (planOnly) {
    const byDoc = new Map<string, number>();
    for (const c of pendingChunks) byDoc.set(c.document, (byDoc.get(c.document) ?? 0) + 1);
    console.log(byDoc.size ? 'Documents that would be (re-)embedded:' : 'Nothing would be re-embedded: every chunk matches the committed index.');
    for (const [doc, n] of byDoc) console.log(`  ${doc}: ${n} chunks`);
    return;
  }

  // Save chunking to disk immediately
  saveIndexAtomically(outputPath, allChunks);

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.log(`NOTICE: GEMINI_API_KEY is not configured in .env.local.`);
    console.log(`All chunks are saved to data/index.json.`);
    printRandomChunks(allChunks, 3);
    return;
  }

  if (pendingChunks.length === 0) {
    console.log(`✓ All ${allChunks.length} chunks already have embeddings! Nothing to embed.`);
    writeSearchFiles(dataDir, allChunks);
    printRandomChunks(allChunks, 3);
    return;
  }

  console.log(`Connecting to Gemini API with model: ${EMBEDDING_MODEL_NAME}`);
  console.log(`Embedding ${pendingChunks.length} chunks in batches of 16 (saving progress after each batch)...\n`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const embeddingModel = getEmbeddingModel(genAI);

  const BATCH_SIZE = 16;
  let batchCount = 0;
  const totalBatches = Math.ceil(pendingChunks.length / BATCH_SIZE);

  for (let i = 0; i < pendingChunks.length; i += BATCH_SIZE) {
    batchCount++;
    const batch = pendingChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.textToEmbed);

    const result = await embedBatchWithRetry(embeddingModel, texts);

    if (result.dailyQuotaExceeded) {
      console.warn(`\n\n===============================================================`);
      console.warn(`  [QUOTA NOTICE] Free-tier daily quota reached.`);
      console.warn(`===============================================================`);
      const doneSoFar = allChunks.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0).length;
      console.warn(`  Safely stopped. Chunks completed: ${doneSoFar} / ${allChunks.length}.`);
      console.warn(`  Pending chunks remaining        : ${allChunks.length - doneSoFar}.`);
      console.warn(`  Progress saved to data/index.json.`);
      console.warn(`  You can resume anytime by re-running: npm run ingest`);
      console.warn(`===============================================================\n`);
      saveIndexAtomically(outputPath, allChunks);
      printRandomChunks(allChunks, 3);
      // In the scheduled run, a half-built index must not be committed, so fail the job instead.
      process.exit(process.env.CI ? 2 : 0);
    }

    if (result.embeddings) {
      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = result.embeddings[j];
      }
    }

    // Save progress after EACH batch for guaranteed resumability
    saveIndexAtomically(outputPath, allChunks);

    const nowEmbedded = allChunks.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0).length;
    const pct = ((nowEmbedded / allChunks.length) * 100).toFixed(1);
    process.stdout.write(
      `\r[Batch ${batchCount}/${totalBatches}] Progress: ${nowEmbedded}/${allChunks.length} chunks (${pct}%) saved to index.json`
    );

    // Rate-limiting delay between requests (400ms)
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  console.log(`\n\n✓ All embeddings successfully generated with ${EMBEDDING_MODEL_NAME}!`);
  writeSearchFiles(dataDir, allChunks);

  const stats = fs.statSync(outputPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const timeTakenStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  console.log(`\n===============================================================`);
  console.log(`  Final Ingestion Summary`);
  console.log(`===============================================================`);
  console.log(`  Documents Processed : ${files.length}`);
  console.log(`  Pages Processed     : ${totalPagesProcessed}`);
  console.log(`  Chunks Generated    : ${allChunks.length}`);
  console.log(`  Time Taken          : ${timeTakenStr}`);
  console.log(`  Embedding Model     : ${EMBEDDING_MODEL_NAME} (dimension: ${allChunks[0]?.embedding?.length || 3072})`);
  console.log(`  Index Saved To      : data/index.json (${sizeMb} MB)`);
  console.log(`===============================================================\n`);

  printRandomChunks(allChunks, 3);
}

if (require.main === module || process.argv[1]?.endsWith('ingest.ts')) {
  main().catch(err => {
    console.error('Fatal error during ingestion:', err);
    process.exit(1);
  });
}
