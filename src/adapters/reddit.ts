import axios from 'axios';
import { NormalizedResult, CodeSnippet } from '../types/index.js';
import { redditLimiter, withRetry } from '../utils/rateLimiter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load subreddit configuration
const configPath = path.join(__dirname, '../../config/reddit-subreddits.json');
const subredditConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

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

  async search(query: string, maxResults = 5): Promise<NormalizedResult[]> {
    try {
      return await redditLimiter.schedule(() =>
        withRetry(() => this.performSearch(query, maxResults))
      );
    } catch (error) {
      console.error('Reddit search error:', error);
      return [];
    }
  }

  private async performSearch(query: string, maxResults: number): Promise<NormalizedResult[]> {
    // Select relevant subreddits based on the query
    const subreddits = this.selectSubreddits(query);
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
          
          // Apply quality filters
          if (!this.passesQualityFilters(post)) {
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

    // Always include some general programming subreddits
    const generalSubs = ['programming', 'askprogramming', 'learnprogramming'];
    generalSubs.forEach(sub => selectedSubreddits.add(sub));

    // Check tech mappings
    for (const [tech, subs] of Object.entries(subredditConfig.techMapping)) {
      if (queryLower.includes(tech.toLowerCase())) {
        (subs as string[]).forEach(sub => selectedSubreddits.add(sub));
      }
    }

    // If we haven't found many specific subreddits, add defaults
    if (selectedSubreddits.size < 3) {
      subredditConfig.defaultSubreddits.slice(0, 5).forEach((sub: string) => 
        selectedSubreddits.add(sub)
      );
    }

    // Limit to maxSubredditsPerQuery
    const maxSubs = subredditConfig.searchSettings.maxSubredditsPerQuery || 5;
    return Array.from(selectedSubreddits).slice(0, maxSubs);
  }

  private passesQualityFilters(post: RedditPost): boolean {
    const thresholds = subredditConfig.qualityThresholds;

    // Skip NSFW content
    if (post.over_18) {
      return false;
    }

    // Check minimum score
    if (post.score < (thresholds.minScore || 5)) {
      return false;
    }

    // Check minimum comments for discussion
    if (post.num_comments < (thresholds.minComments || 3)) {
      return false;
    }

    // Check upvote ratio (may not always be available)
    if (post.upvote_ratio && post.upvote_ratio < (thresholds.minUpvoteRatio || 0.7)) {
      return false;
    }

    // Check age (convert months to seconds)
    const maxAgeSeconds = (thresholds.maxAgeMonths || 24) * 30 * 24 * 60 * 60;
    const postAge = Date.now() / 1000 - post.created_utc;
    if (postAge > maxAgeSeconds) {
      return false;
    }

    return true;
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
        isAccepted: post.score > 50 && post.upvote_ratio > 0.9, // High quality indicator
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
}