import axios from 'axios';
import { NormalizedResult, CodeSnippet } from '../types/index.js';
import { redditLimiter, withRetry } from '../utils/rateLimiter.js';
import { RedditSearchStrategy, ProblemType } from '../core/queryAnalyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load subreddit configuration
const configPath = path.join(__dirname, '../../config/reddit-subreddits.json');
const subredditConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Load filter configuration
const filtersPath = path.join(__dirname, '../config/filters.json');
const filters = JSON.parse(fs.readFileSync(filtersPath, 'utf-8'));

interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  author: string;
  created_utc: number;
  edited: number | boolean;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  selftext: string;
  selftext_html: string | null;
  subreddit: string;
  subreddit_name_prefixed: string;
  link_flair_text: string | null;
  over_18: boolean;
  is_self: boolean;
}

interface RedditResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: RedditPost;
    }>;
    after: string | null;
    before: string | null;
  };
}

export class RedditAdapter {
  private userAgent: string;

  constructor() {
    this.userAgent = process.env.REDDIT_USER_AGENT || 'DevScope-MCP-Server/1.0';
  }

  async search(query: string, maxResults = 5, strategy?: RedditSearchStrategy, problemType?: ProblemType): Promise<NormalizedResult[]> {
    try {
      return await redditLimiter.schedule(() =>
        withRetry(() => this.performSearch(query, maxResults, strategy, problemType))
      );
    } catch (error) {
      console.error('Reddit search error:', error);
      return [];
    }
  }

  private async performSearch(query: string, maxResults: number, strategy?: RedditSearchStrategy, problemType?: ProblemType): Promise<NormalizedResult[]> {
    // Select relevant subreddits based on strategy or fallback to query analysis
    const subreddits = strategy?.subreddits || this.selectSubreddits(query);
    console.log(`Searching Reddit in subreddits: ${subreddits.join(', ')}`);

    const allResults: NormalizedResult[] = [];

    try {
      // Search in combined subreddits using public JSON API
      const subredditString = subreddits.join('+');
      const searchUrl = `https://www.reddit.com/r/${subredditString}/search.json`;
      
      const response = await axios.get<RedditResponse>(searchUrl, {
        params: {
          q: query,
          restrict_sr: 'on', // Restrict to these subreddits
          sort: 'relevance',
          t: 'year', // Time window
          limit: Math.min(maxResults * 2, 25), // Get more to filter
        },
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (response.data && response.data.data && response.data.data.children) {
        for (const child of response.data.data.children) {
          const post = child.data;
          
          // Apply enhanced quality filters
          if (!this.passesQualityFilters(post, strategy, problemType)) {
            continue;
          }
          
          // Apply flair filtering
          if (!this.passesFlairFilters(post, strategy)) {
            continue;
          }
          
          // Apply title filtering
          if (!this.passesTitleFilters(post)) {
            continue;
          }

          const normalized = this.normalizeResult(post);
          if (normalized) {
            allResults.push(normalized);
          }

          if (allResults.length >= maxResults) {
            break;
          }
        }
      }
    } catch (error) {
      console.error('Error searching Reddit:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
      }
      throw error;
    }

    console.log(`Reddit search returned ${allResults.length} quality results`);
    return allResults;
  }

  private selectSubreddits(query: string): string[] {
    const queryLower = query.toLowerCase();
    const selectedSubreddits = new Set<string>();

    // Prioritize tier 1 subreddits for better quality
    const tier1Subs = filters.reddit.subredditQuality.tier1;
    
    // Check tech mappings with quality prioritization
    for (const [tech, subs] of Object.entries(subredditConfig.techMapping)) {
      if (queryLower.includes(tech.toLowerCase())) {
        // Prioritize tier 1 subreddits from tech mapping
        (subs as string[]).forEach(sub => {
          if (tier1Subs.includes(sub)) {
            selectedSubreddits.add(sub);
          }
        });
        // Add other tech-specific subreddits if we have room
        if (selectedSubreddits.size < 3) {
          (subs as string[]).forEach(sub => selectedSubreddits.add(sub));
        }
      }
    }

    // If we haven't found enough specific subreddits, add high-quality defaults
    if (selectedSubreddits.size < 2) {
      // Add tier 1 subreddits first
      tier1Subs.slice(0, 3).forEach((sub: string) => selectedSubreddits.add(sub));
    }
    
    // Add tier 2 if we still need more
    if (selectedSubreddits.size < 3) {
      const tier2Subs = filters.reddit.subredditQuality.tier2;
      tier2Subs.slice(0, 2).forEach((sub: string) => selectedSubreddits.add(sub));
    }

    // Limit to maxSubredditsPerQuery
    const maxSubs = subredditConfig.searchSettings.maxSubredditsPerQuery || 5;
    return Array.from(selectedSubreddits).slice(0, maxSubs);
  }

  private passesQualityFilters(post: RedditPost, strategy?: RedditSearchStrategy, problemType?: ProblemType): boolean {
    // Skip NSFW content
    if (post.over_18) {
      return false;
    }

    // Get problem-type specific thresholds or defaults
    const baseThresholds = filters.reddit.qualityThresholds;
    const problemThresholds = problemType ? 
      baseThresholds[problemType] || baseThresholds :
      baseThresholds;

    // Check minimum score
    const minScore = strategy?.minEngagement || problemThresholds.minScore || baseThresholds.minScore;
    if (post.score < minScore) {
      return false;
    }

    // Check minimum comments for discussion
    const minComments = problemThresholds.minComments || baseThresholds.minComments;
    if (post.num_comments < minComments) {
      return false;
    }

    // Check upvote ratio (may not always be available)
    const minUpvoteRatio = problemThresholds.minUpvoteRatio || baseThresholds.minUpvoteRatio;
    if (post.upvote_ratio && post.upvote_ratio < minUpvoteRatio) {
      return false;
    }

    // Check age (convert months to seconds)
    const maxAgeMonths = problemThresholds.maxAgeMonths || baseThresholds.maxAgeMonths;
    const maxAgeSeconds = maxAgeMonths * 30 * 24 * 60 * 60;
    const postAge = Date.now() / 1000 - post.created_utc;
    if (postAge > maxAgeSeconds) {
      return false;
    }

    // Additional quality checks for specific problem types
    if (problemType === ProblemType.BEST_PRACTICE) {
      // Best practice discussions should have higher engagement
      if (post.score < 15 || post.num_comments < 8) {
        return false;
      }
    }

    return true;
  }

  private passesFlairFilters(post: RedditPost, strategy?: RedditSearchStrategy): boolean {
    if (!post.link_flair_text) {
      return true; // No flair to filter
    }

    const excludeFlairs = strategy?.excludeFlairs || filters.reddit.excludeFlairs;
    const flair = post.link_flair_text.toLowerCase();
    
    return !excludeFlairs.some((excludeFlair: string) => 
      flair.includes(excludeFlair.toLowerCase())
    );
  }

  private passesTitleFilters(post: RedditPost): boolean {
    const excludePatterns = filters.reddit.titleFilters.exclude;
    const title = post.title.toLowerCase();
    
    return !excludePatterns.some((pattern: string) => {
      try {
        return new RegExp(pattern, 'i').test(title);
      } catch {
        return title.includes(pattern.toLowerCase());
      }
    });
  }

  private normalizeResult(post: RedditPost): NormalizedResult | null {
    try {
      const content = this.buildContent(post);
      const codeSnippets = this.extractCodeSnippets(content);

      return {
        title: post.title,
        url: `https://reddit.com${post.permalink}`,
        source: 'reddit' as const,
        author: post.author || 'deleted',
        createdAt: new Date(post.created_utc * 1000),
        updatedAt: post.edited && typeof post.edited === 'number' 
          ? new Date(post.edited * 1000)
          : undefined,
        score: this.calculateScore(post),
        content,
        codeSnippets,
        tags: this.extractTags(post),
        subreddit: post.subreddit,
        upvoteRatio: post.upvote_ratio,
        voteCount: post.score,
        isAccepted: this.isHighQualityPost(post), // Enhanced quality indicator
      };
    } catch (error) {
      console.error('Error normalizing Reddit post:', error);
      return null;
    }
  }

  private buildContent(post: RedditPost): string {
    let content = '';

    // Add subreddit context
    content += `Subreddit: r/${post.subreddit}\n`;
    
    // Add metrics
    content += `Score: ${post.score} | Comments: ${post.num_comments}`;
    if (post.upvote_ratio) {
      content += ` | Upvote Ratio: ${(post.upvote_ratio * 100).toFixed(0)}%`;
    }
    content += '\n\n';

    // Add post content
    if (post.is_self && post.selftext) {
      content += post.selftext;
    } else if (!post.is_self) {
      content += `Link post: ${post.url}\n`;
      if (post.selftext) {
        content += `\nDescription: ${post.selftext}`;
      }
    }

    return content;
  }

  private extractCodeSnippets(content: string): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    
    // Reddit uses ``` for code blocks
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'plaintext';
      const code = match[2].trim();
      
      if (code.length > 10) { // Skip very short snippets
        snippets.push({
          language,
          code,
        });
      }
    }

    // Also look for indented code blocks (4 spaces)
    const indentedCodeRegex = /(?:^|\n)((?:    .+\n?)+)/gm;
    while ((match = indentedCodeRegex.exec(content)) !== null) {
      const code = match[1].replace(/^    /gm, '').trim();
      if (code.length > 20 && !code.includes('http')) { // Skip URLs
        snippets.push({
          language: 'plaintext',
          code,
        });
      }
    }

    return snippets.slice(0, 5); // Limit to 5 snippets
  }

  private extractTags(post: RedditPost): string[] {
    const tags: string[] = [];

    // Add subreddit as a tag
    if (post.subreddit) {
      tags.push(post.subreddit);
    }

    // Add flair as a tag if present
    if (post.link_flair_text) {
      tags.push(post.link_flair_text.toLowerCase());
    }

    // Extract technology keywords from title
    const techKeywords = Object.keys(subredditConfig.techMapping);
    const titleLower = post.title.toLowerCase();
    
    for (const tech of techKeywords) {
      if (titleLower.includes(tech.toLowerCase())) {
        tags.push(tech);
      }
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  private calculateScore(post: RedditPost): number {
    // Weighted scoring for Reddit posts
    let score = 0;

    // Base score from upvotes
    score += Math.min(post.score, 100); // Cap at 100

    // Engagement score from comments
    score += Math.min(post.num_comments * 2, 50); // Cap at 50

    // Quality score from upvote ratio
    if (post.upvote_ratio) {
      score += Math.round(post.upvote_ratio * 30); // Max 30
    }

    // Recency bonus (posts from last 3 months)
    const ageInDays = (Date.now() / 1000 - post.created_utc) / (60 * 60 * 24);
    if (ageInDays < 90) {
      score += Math.round((90 - ageInDays) / 3); // Max 30 points
    }

    return Math.round(score);
  }

  private isHighQualityPost(post: RedditPost): boolean {
    // Multiple criteria for high quality posts
    const hasHighScore = post.score > 50;
    const hasGoodRatio = post.upvote_ratio > 0.9;
    const hasGoodEngagement = post.num_comments > 10;
    const hasModerateScore = post.score > 20 && post.upvote_ratio > 0.8;
    
    return (hasHighScore && hasGoodRatio) || 
           (hasGoodEngagement && hasModerateScore);
  }
}