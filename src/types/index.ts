export interface CodeSnippet {
  language: string;
  code: string;
  lineNumbers?: {
    start: number;
    end: number;
  };
}

export interface NormalizedResult {
  title: string;
  url: string;
  source: 'stackoverflow' | 'github';
  author: string;
  createdAt: Date;
  updatedAt?: Date;
  score: number;
  content: string;
  codeSnippets: CodeSnippet[];
  tags: string[];
  version?: string;
  isAccepted?: boolean;
  voteCount?: number;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  sources?: ('stackoverflow' | 'github')[];
  depth?: 'quick' | 'thorough';
  timeWindow?: {
    days?: number;
    from?: Date;
    to?: Date;
  };
}

export interface GatherContextResult {
  summary: string;
  highlights: string[];
  citations: Citation[];
  snippets: CodeSnippet[];
  stats: {
    elapsedMs: number;
    sourceCounts: Record<string, number>;
    cacheHits: number;
    incompleteSources?: string[];
  };
}

export interface Citation {
  title: string;
  url: string;
  source: string;
  author: string;
  createdAt: string;
  score: number;
  version?: string;
  snippet: string;
}

export interface RankedResult extends NormalizedResult {
  relevanceScore: number;
  recencyScore: number;
  communityScore: number;
  finalScore: number;
}