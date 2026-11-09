// Shapes of the data the browser receives from /api/ask.
// Kept separate from src/lib so no server code (fs, API keys) ends up in the browser bundle.

export interface ChunkView {
  id: string;
  document: string;
  contextLine: string;
  chapter: string;
  sections: string[];
  pageRange: string;
  paragraphNumbers: string[];
  date: string;
  entity: string;
  text: string;
}

export interface ResultView {
  rank: number;
  score: number;
  vectorScore: number;
  bm25Score: number;
  via?: 'crossref' | 'profile';
  chunk: ChunkView;
}

export interface CitationView {
  raw: string;
  documentTitle: string;
  paragraph: string;
  page: string;
  verified: boolean;
  matchingChunkId?: string;
}

export type NotFoundReason = 'off_topic' | 'not_in_docs';
export type SearchMode = 'focused' | 'all_directions';

export type SupportVerdict = 'supported' | 'partial' | 'unsupported';

export interface SupportResult {
  title: string;
  paragraph: string;
  chunkId: string;
  statement: string;
  verdict: SupportVerdict;
  reason: string;
}

export interface StatusUpdate {
  step: 'cache' | 'rewrite' | 'search' | 'crossref' | 'write' | 'check';
  message: string;
}

export type ServerEvent =
  | ({ type: 'status' } & StatusUpdate)
  | { type: 'support'; results: SupportResult[] }
  | { type: 'token'; content: string }
  | {
      type: 'done';
      id: string;
      answer: string;
      citations: CitationView[];
      unverifiedCitations: CitationView[];
      retrievedResults: ResultView[];
      timeTakenMs: number;
      isNotFound: boolean;
      notFoundReason?: NotFoundReason;
      searchMode?: SearchMode;
      searchQuery?: string;
      standaloneQuestion?: string;
      cached?: boolean;
      cutShort?: boolean;
      modelUsed: string;
    }
  | { type: 'error'; message: string };

export interface Turn {
  id: string;
  /** The server's id for this answer (used for feedback and the audit log). */
  answerId?: string;
  steps: StatusUpdate[];
  support?: SupportResult[];
  supportPending?: boolean;
  cached?: boolean;
  standaloneQuestion?: string;
  profileLabel?: string;
  isFollowUp?: boolean;
  question: string;
  answer: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  citations: CitationView[];
  unverified: CitationView[];
  results: ResultView[];
  timeMs?: number;
  model?: string;
  isNotFound?: boolean;
  notFoundReason?: NotFoundReason;
  searchMode?: SearchMode;
  searchQuery?: string;
}

export interface PanelState {
  result: ResultView;
  paragraph?: string;
}
