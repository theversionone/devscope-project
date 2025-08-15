import { SearchOptions, GatherContextResult, NormalizedResult } from '../types/index.js';
import { StackOverflowAdapter } from '../adapters/stackoverflow.js';
import { GitHubRestAdapter } from '../adapters/github-rest.js';
import { RedditAdapter } from '../adapters/reddit.js';
import { ResultRanker } from '../core/ranker.js';
import { ResultAggregator } from '../core/aggregator.js';
import { LRUCache } from '../utils/cache.js';
import { withFallback } from '../utils/errorHandler.js';
import { QueryAnalyzer } from '../core/queryAnalyzer.js';

// Initialize cache
const cache = new LRUCache<GatherContextResult>(
  100,
  parseInt(process.env.CACHE_TTL || '900')
);

// Initialize adapters (lazy initialization for Reddit)
const stackOverflowAdapter = new StackOverflowAdapter();
const githubAdapter = new GitHubRestAdapter();
let redditAdapter: RedditAdapter | null = null;

// Initialize query analyzer
const queryAnalyzer = new QueryAnalyzer();

function getRedditAdapter(): RedditAdapter {
  if (!redditAdapter) {
    redditAdapter = new RedditAdapter();
  }
  return redditAdapter;
}

export async function gatherDeveloperContext(
  options: SearchOptions
): Promise<GatherContextResult> {
  const startTime = Date.now();

  // Check cache first
  const cacheKey = {
    query: options.query,
    sources: options.sources || ['stackoverflow', 'github', 'reddit'],
    maxResults: options.maxResults || 5,
    depth: options.depth || 'quick',
  };

  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log('Cache hit for query:', options.query);
    // Update elapsed time and cache hits
    cachedResult.stats.cacheHits++;
    cachedResult.stats.elapsedMs = Date.now() - startTime;
    return cachedResult;
  }

  console.log('Gathering context for query:', options.query);
  
  // Analyze the query to determine search strategy
  const analysis = queryAnalyzer.analyze(options.query);
  console.log(`Query analysis - Problem type: ${analysis.problemType}, Technologies: ${analysis.technologies.join(', ')}, Specificity: ${analysis.specificity}`);

  // Determine which sources to search
  const sources = options.sources || ['stackoverflow', 'github', 'reddit'];
  const maxResults = options.maxResults || parseInt(process.env.MAX_RESULTS_PER_SOURCE || '5');

  // Search sources in parallel
  const searchPromises: Promise<NormalizedResult[]>[] = [];
  const incompleteSources: string[] = [];

  if (sources.includes('stackoverflow')) {
    searchPromises.push(
      stackOverflowAdapter.search(options.query, maxResults, analysis.searchStrategies.stackoverflow, analysis.problemType)
        .then(results => {
          console.log(`Stack Overflow returned ${results.length} results`);
          return results;
        })
        .catch(error => {
          console.error('Stack Overflow search failed:', error);
          incompleteSources.push('stackoverflow');
          return [];
        })
    );
  }

  if (sources.includes('github')) {
    searchPromises.push(
      withFallback(
        () => githubAdapter.search(options.query, maxResults, analysis.searchStrategies.github, analysis.problemType),
        [],
        'GitHub'
      ).catch(error => {
        console.error('GitHub search failed:', error);
        incompleteSources.push('github');
        return [];
      })
    );
  }

  if (sources.includes('reddit')) {
    searchPromises.push(
      getRedditAdapter().search(options.query, maxResults, analysis.searchStrategies.reddit, analysis.problemType)
        .then(results => {
          console.log(`Reddit returned ${results.length} results`);
          return results;
        })
        .catch(error => {
          console.error('Reddit search failed:', error);
          incompleteSources.push('reddit');
          return [];
        })
    );
  }

  // Wait for all searches to complete
  const searchResults = await Promise.all(searchPromises);

  // Flatten and combine results
  const allResults = searchResults.flat();

  if (allResults.length === 0) {
    const emptyResult: GatherContextResult = {
      summary: 'No results found. All data sources may be unavailable or the query returned no matches.',
      highlights: [],
      citations: [],
      snippets: [],
      stats: {
        elapsedMs: Date.now() - startTime,
        sourceCounts: {},
        cacheHits: 0,
        incompleteSources: incompleteSources.length > 0 ? incompleteSources : undefined,
      },
    };
    return emptyResult;
  }

  // Rank results with problem type awareness
  const ranker = new ResultRanker(options.query, analysis.problemType);
  const rankedResults = ranker.rankResults(allResults);

  // Aggregate results
  const aggregator = new ResultAggregator();
  const result = aggregator.aggregateResults(
    rankedResults,
    Date.now() - startTime,
    0,
    incompleteSources.length > 0 ? incompleteSources : undefined
  );

  // Cache the result with analysis information
  const enhancedResult = {
    ...result,
    queryAnalysis: {
      problemType: analysis.problemType,
      technologies: analysis.technologies,
      specificity: analysis.specificity
    }
  };
  cache.set(cacheKey, enhancedResult);

  return enhancedResult;
}