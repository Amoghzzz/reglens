import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { EMBEDDING_MODEL_NAME } from './embeddings';

export interface ChunkMetadata {
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
}

export interface SearchResult {
  chunk: ChunkMetadata;
  score: number;
  vectorScore: number;
  bm25Score: number;
  rank: number;
  /** Why a passage was added beyond normal ranking: followed from a cross-reference, or the user's own Direction. */
  via?: 'crossref' | 'profile';
}

let cachedChunks: ChunkMetadata[] | null = null;
let cachedVectors: Float32Array | null = null;
let cachedNorms: Float32Array | null = null;
const VECTOR_DIM = 3072;

export function loadSearchIndex(): { chunks: ChunkMetadata[]; vectors: Float32Array; norms: Float32Array } {
  if (cachedChunks && cachedVectors && cachedNorms) {
    return { chunks: cachedChunks, vectors: cachedVectors, norms: cachedNorms };
  }

  const chunksPath = path.resolve(process.cwd(), 'data/chunks.json');
  const vectorsPath = path.resolve(process.cwd(), 'data/vectors.bin');

  if (!fs.existsSync(chunksPath) || !fs.existsSync(vectorsPath)) {
    throw new Error(`Index files not found at ${chunksPath} or ${vectorsPath}. Run 'npm run ingest' first.`);
  }

  const chunksRaw = fs.readFileSync(chunksPath, 'utf8');
  cachedChunks = JSON.parse(chunksRaw);

  const binBuffer = fs.readFileSync(vectorsPath);
  cachedVectors = new Float32Array(
    binBuffer.buffer,
    binBuffer.byteOffset,
    binBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
  );

  const count = cachedChunks!.length;
  cachedNorms = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let sumSq = 0;
    const offset = i * VECTOR_DIM;
    for (let d = 0; d < VECTOR_DIM; d++) {
      const val = cachedVectors[offset + d];
      sumSq += val * val;
    }
    cachedNorms[i] = Math.sqrt(sumSq) || 1e-9;
  }

  return { chunks: cachedChunks!, vectors: cachedVectors, norms: cachedNorms };
}

/**
 * Tokenize string into clean search terms
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * BM25 Implementation
 */
export class BM25Index {
  private docLengths: number[];
  private avgdl: number;
  private df: Map<string, number>;
  private docTermFreqs: Map<string, number>[];
  private N: number;
  private k1: number = 1.2;
  private b: number = 0.75;

  constructor(documents: string[]) {
    this.N = documents.length;
    this.docLengths = new Array(this.N);
    this.df = new Map();
    this.docTermFreqs = new Array(this.N);

    let totalLength = 0;
    for (let i = 0; i < this.N; i++) {
      const tokens = tokenize(documents[i]);
      this.docLengths[i] = tokens.length;
      totalLength += tokens.length;

      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
      }
      this.docTermFreqs[i] = tf;

      // Update doc frequency
      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }
    this.avgdl = totalLength / (this.N || 1);
  }

  public score(query: string): Float32Array {
    const scores = new Float32Array(this.N);
    const queryTokens = tokenize(query);
    const queryLower = query.toLowerCase();

    // Check for exact phrase or paragraph numbers in query
    const paraMatch = queryLower.match(/(?:para(?:graph)?|section)\s+(\d+[A-Z]?)/);
    const targetPara = paraMatch ? paraMatch[1] : null;

    for (const term of queryTokens) {
      const docFreq = this.df.get(term) || 0;
      if (docFreq === 0) continue;

      // Robertson-Spärck Jones IDF
      const idf = Math.log(1 + (this.N - docFreq + 0.5) / (docFreq + 0.5));

      for (let i = 0; i < this.N; i++) {
        const tf = this.docTermFreqs[i].get(term) || 0;
        if (tf === 0) continue;

        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (this.docLengths[i] / this.avgdl));
        scores[i] += idf * (numerator / denominator);
      }
    }

    // Exact phrase and paragraph number boosting
    for (let i = 0; i < this.N; i++) {
      if (targetPara && (this.docTermFreqs[i].has(targetPara) || this.docTermFreqs[i].has(`para ${targetPara}`))) {
        scores[i] *= 1.3;
      }
    }

    return scores;
  }
}

let cachedBM25: BM25Index | null = null;

export function getBM25Index(chunks: ChunkMetadata[]): BM25Index {
  if (!cachedBM25) {
    const docs = chunks.map(c => `${c.contextLine}\n${c.text}`);
    cachedBM25 = new BM25Index(docs);
  }
  return cachedBM25;
}

interface QueryCache {
  [query: string]: number[];
}

const CACHE_FILE = path.resolve(process.cwd(), 'data/query_cache.json');
let queryCache: QueryCache | null = null;

function loadQueryCache(): QueryCache {
  if (queryCache) return queryCache;
  if (fs.existsSync(CACHE_FILE)) {
    try {
      queryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return queryCache!;
    } catch {
      queryCache = {};
    }
  } else {
    queryCache = {};
  }
  return queryCache!;
}

function saveQueryCache(query: string, vec: number[]) {
  const cache = loadQueryCache();
  cache[query.trim().toLowerCase()] = vec;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch (err) {
    console.error('Failed to save query cache:', err);
  }
}

/** Makes sure the best passage from each named document (e.g. the user's own type of NBFC) is included. */
function withIncludedDocs(picked: SearchResult[], sorted: SearchResult[], includeDocs?: string[]): SearchResult[] {
  if (!includeDocs?.length) return picked;
  const out = [...picked];
  for (const name of includeDocs) {
    if (out.some((r) => r.chunk.document.includes(name))) continue;
    const best = sorted.find((r) => r.chunk.document.includes(name));
    if (best) out.push({ ...best, via: 'profile' });
  }
  return out;
}

/** Finds chunks of a Direction (matched loosely by title) that contain the given paragraph numbers. */
export function findParagraphChunks(titleHint: string, paras: string[]): ChunkMetadata[] {
  const { chunks } = loadSearchIndex();
  const norm = (s: string) =>
    s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(rbi|reserve bank of india|non-banking financial companies|directions?|master|for|nbfcs?|the|of|and|on)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
  const want = norm(titleHint);
  if (!want) return [];
  const docChunks = chunks.filter((c) => {
    const t = norm(c.contextLine.split('>')[0]) || norm(c.topic);
    return t && (t.includes(want) || want.includes(t));
  });
  const out: ChunkMetadata[] = [];
  for (const p of paras) {
    const hit = docChunks.find(
      (c) => c.paragraphNumbers.includes(p) || new RegExp(`(^|\\n)\\s*(?:\\d+\\[)?${p}\\]?\\.\\s`).test(c.text)
    );
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Breadth + depth for list questions (input must already be sorted best-first):
 * the top K passages overall, plus the best passage from every document not already covered.
 */
function bestPerDocument(sorted: SearchResult[], topK: number): SearchResult[] {
  const out = sorted.slice(0, topK);
  const seen = new Set(out.map((r) => r.chunk.document));
  for (const r of sorted.slice(topK)) {
    if (seen.has(r.chunk.document)) continue;
    seen.add(r.chunk.document);
    out.push(r);
  }
  return out;
}

/**
 * Hybrid Search combining Vector Similarity & BM25 via Reciprocal Rank Fusion (RRF)
 */
/**
 * perDocument: return the top K passages plus the best passage from EACH other document.
 * Used for list / "all" questions, where the answer is spread across many Directions.
 */
export async function hybridSearch(
  query: string,
  topK: number = 8,
  apiKey?: string,
  options: { perDocument?: boolean; includeDocs?: string[] } = {}
): Promise<SearchResult[]> {
  const { chunks, vectors, norms } = loadSearchIndex();
  const bm25 = getBM25Index(chunks);
  const count = chunks.length;

  // 1. Vector Search
  let qVec: number[] | null = null;
  const cache = loadQueryCache();
  const normalizedQuery = query.trim().toLowerCase();

  if (cache[normalizedQuery]) {
    qVec = cache[normalizedQuery];
  } else {
    const key = apiKey || process.env.GEMINI_API_KEY?.trim();
    if (key) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

        const embedRes = await embeddingModel.embedContent({
          content: { role: 'user', parts: [{ text: query }] },
          taskType: TaskType.RETRIEVAL_QUERY
        });

        qVec = embedRes.embedding.values;
        saveQueryCache(query, qVec);
      } catch (err: any) {
        console.warn(`Vector embedding fallback to BM25 (${err.message || 'quota exceeded'}).`);
      }
    }
  }

  // 2. BM25 Search
  const bm25Scores = bm25.score(query);

  // If vector is available, do Hybrid RRF
  if (qVec) {
    let qNormSq = 0;
    for (let d = 0; d < VECTOR_DIM; d++) qNormSq += qVec[d] * qVec[d];
    const qNorm = Math.sqrt(qNormSq) || 1e-9;

    const vectorScores = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let dot = 0;
      const offset = i * VECTOR_DIM;
      for (let d = 0; d < VECTOR_DIM; d++) {
        dot += qVec[d] * vectors[offset + d];
      }
      vectorScores[i] = dot / (qNorm * norms[i]);
    }

    const vectorRanked = Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => vectorScores[b] - vectorScores[a]);

    const bm25Ranked = Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => bm25Scores[b] - bm25Scores[a]);

    const vectorRankMap = new Map<number, number>();
    const bm25RankMap = new Map<number, number>();

    for (let rank = 0; rank < count; rank++) {
      vectorRankMap.set(vectorRanked[rank], rank + 1);
      bm25RankMap.set(bm25Ranked[rank], rank + 1);
    }

    const RRF_K = 60;
    const combined = Array.from({ length: count }, (_, i) => {
      const vRank = vectorRankMap.get(i)!;
      const bRank = bm25RankMap.get(i)!;
      const rrfScore = (1 / (RRF_K + vRank)) + (1 / (RRF_K + bRank));

      return {
        chunk: chunks[i],
        score: rrfScore,
        vectorScore: vectorScores[i],
        bm25Score: bm25Scores[i],
        rank: 0
      };
    });

    combined.sort((a, b) => b.score - a.score);
    const topResults = withIncludedDocs(
      options.perDocument ? bestPerDocument(combined, topK) : combined.slice(0, topK),
      combined,
      options.includeDocs
    );
    topResults.forEach((r, idx) => {
      r.rank = idx + 1;
    });
    return topResults;
  }

  // Fallback to BM25 if vector embedding quota is exceeded
  const bm25Ranked = Array.from({ length: count }, (_, i) => ({
    chunk: chunks[i],
    score: bm25Scores[i],
    vectorScore: 0,
    bm25Score: bm25Scores[i],
    rank: 0
  })).sort((a, b) => b.score - a.score);

  const topResults = withIncludedDocs(
    options.perDocument ? bestPerDocument(bm25Ranked, topK) : bm25Ranked.slice(0, topK),
    bm25Ranked,
    options.includeDocs
  );
  topResults.forEach((r, idx) => {
    r.rank = idx + 1;
  });
  return topResults;
}
