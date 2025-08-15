import axios from 'axios';
import { NormalizedResult, CodeSnippet } from '../types/index.js';
import { githubLimiter, withRetry } from '../utils/rateLimiter.js';
import { handleAPIError } from '../utils/errorHandler.js';
import { GitHubSearchStrategy, ProblemType } from '../core/queryAnalyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load filter configuration
const filtersPath = path.join(__dirname, '../config/filters.json');
const filters = JSON.parse(fs.readFileSync(filtersPath, 'utf-8'));

const BASE_URL = 'https://api.github.com';

interface GitHubIssue {
  id: number;
  title: string;
  html_url: string;
  number: number;
  state: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
  };
  repository_url: string;
  labels: Array<{
    name: string;
  }>;
  body: string | null;
  comments: number;
  reactions?: {
    total_count: number;
    '+1': number;
  };
}

interface GitHubRepo {
  full_name: string;
  stargazers_count: number;
}

export class GitHubRestAdapter {
  private headers: Record<string, string>;

  constructor() {
    const token = process.env.GITHUB_TOKEN;
    
    this.headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'DevScope-MCP-Server',
    };

    if (token) {
      this.headers['Authorization'] = `Bearer ${token}`;
    }
  }

  async search(query: string, maxResults = 5, strategy?: GitHubSearchStrategy, problemType?: ProblemType): Promise<NormalizedResult[]> {
    try {
      return await githubLimiter.schedule(() =>
        withRetry(() => this.performSearch(query, maxResults, strategy, problemType))
      );
    } catch (error) {
      handleAPIError(error, 'GitHub');
      return [];
    }
  }

  private async performSearch(query: string, maxResults: number, strategy?: GitHubSearchStrategy, problemType?: ProblemType): Promise<NormalizedResult[]> {
    try {
      // Build enhanced search query with filtering
      const searchQuery = this.buildSearchQuery(query, strategy, problemType);
      
      const response = await axios.get(`${BASE_URL}/search/issues`, {
        headers: this.headers,
        params: {
          q: searchQuery,
          sort: problemType === ProblemType.BUG_REPORT ? 'updated' : 'reactions',
          order: 'desc',
          per_page: Math.min(maxResults * 2, 50), // Get more to filter
        },
      });

      const issues = response.data.items || [];
      
      // Log rate limit info
      const remaining = response.headers['x-ratelimit-remaining'];
      const reset = response.headers['x-ratelimit-reset'];
      console.log(`GitHub API - Remaining: ${remaining}, Reset: ${new Date(parseInt(reset) * 1000).toLocaleTimeString()}`);

      // Fetch repository details for each issue
      const repoCache = new Map<string, GitHubRepo>();
      for (const issue of issues) {
        const repoUrl = issue.repository_url;
        if (!repoCache.has(repoUrl)) {
          try {
            const repoResponse = await axios.get(repoUrl, { headers: this.headers });
            repoCache.set(repoUrl, repoResponse.data);
          } catch (error) {
            console.error('Failed to fetch repo details:', error);
          }
        }
      }

      // Filter results based on quality criteria
      const filteredIssues = this.filterResults(issues, problemType);
      return this.normalizeResults(filteredIssues.slice(0, maxResults), repoCache, problemType);
    } catch (error) {
      console.error('GitHub search error:', error);
      throw error;
    }
  }

  private buildSearchQuery(query: string, strategy?: GitHubSearchStrategy, _problemType?: ProblemType): string {
    let searchQuery = `${query} in:title,body is:public`;
    
    // Add strategy-specific query modifications
    if (strategy?.query && strategy.query !== query) {
      searchQuery = `${strategy.query} in:title,body is:public`;
    }
    
    // Add exclusion patterns
    const excludePatterns = strategy?.excludePatterns || [];
    const filterExclusions = [
      ...filters.github.excludePatterns.botAccounts.map((bot: string) => `-author:${bot}`),
      ...filters.github.excludePatterns.labels.map((label: string) => `-label:${label}`)
    ];
    
    const allExclusions = [...excludePatterns, ...filterExclusions];
    if (allExclusions.length > 0) {
      searchQuery += ` ${allExclusions.join(' ')}`;
    }
    
    // Add type prioritization
    const prioritizeTypes = strategy?.prioritizeTypes || ['type:issue'];
    if (prioritizeTypes.length > 0) {
      searchQuery += ` (${prioritizeTypes.join(' OR ')})`;
    }
    
    return searchQuery;
  }
  
  private filterResults(issues: GitHubIssue[], problemType?: ProblemType): GitHubIssue[] {
    return issues.filter(issue => {
      // Filter out bot-created issues by title patterns
      const titleFilters = filters.github.excludePatterns.titlePatterns;
      for (const pattern of titleFilters) {
        if (new RegExp(pattern).test(issue.title)) {
          return false;
        }
      }
      
      // Apply quality thresholds
      const thresholds = problemType ? 
        filters.github.qualityThresholds[problemType] || filters.github.qualityThresholds :
        filters.github.qualityThresholds;
      
      if (issue.comments < (thresholds.minComments || 1)) {
        return false;
      }
      
      if ((issue.reactions?.total_count || 0) < (thresholds.minReactions || 0)) {
        return false;
      }
      
      // Filter out very old issues for certain problem types
      if (problemType === ProblemType.BUG_REPORT || problemType === ProblemType.COMPATIBILITY) {
        const daysSinceUpdate = (Date.now() - new Date(issue.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > 365) {
          return false;
        }
      }
      
      return true;
    });
  }

  private normalizeResults(issues: GitHubIssue[], repoCache: Map<string, GitHubRepo>, problemType?: ProblemType): NormalizedResult[] {
    return issues.map(issue => {
      const repo = repoCache.get(issue.repository_url);
      const content = this.buildContent(issue, repo);
      const codeSnippets = this.extractCodeSnippets(content);
      const version = this.extractVersion(issue.title, issue.labels || []);

      return {
        title: issue.title,
        url: issue.html_url,
        source: 'github' as const,
        author: issue.user?.login || 'Unknown',
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        score: this.calculateScore(issue, repo, problemType),
        content,
        codeSnippets,
        tags: issue.labels?.map(label => label.name) || [],
        version,
        isAccepted: issue.state === 'closed',
        voteCount: issue.reactions?.total_count || 0,
      };
    });
  }

  private buildContent(issue: GitHubIssue, repo?: GitHubRepo): string {
    let content = '';

    if (repo) {
      content += `Repository: ${repo.full_name} (⭐ ${repo.stargazers_count})\n\n`;
    }

    content += issue.body || 'No description provided.';

    return content;
  }

  private extractCodeSnippets(content: string): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      snippets.push({
        language: match[1] || 'plaintext',
        code: match[2].trim(),
      });
    }

    return snippets;
  }

  private extractVersion(title: string, labels: Array<{ name: string }>): string | undefined {
    // Try to extract version from title
    const versionRegex = /v?(\d+\.\d+(?:\.\d+)?)/i;
    const titleMatch = title.match(versionRegex);
    if (titleMatch) {
      return titleMatch[1];
    }

    // Try to find version in labels
    const versionLabel = labels.find(label => 
      label.name.match(/^v?\d+\.\d+/) || 
      label.name.includes('version')
    );

    return versionLabel?.name;
  }

  private calculateScore(issue: GitHubIssue, repo?: GitHubRepo, problemType?: ProblemType): number {
    let score = 0;

    // Repository quality scoring
    if (repo) {
      const stars = repo.stargazers_count;
      if (stars > 10000) {
        score += filters.github.repositoryBoosts.official;
      } else if (stars > 1000) {
        score += filters.github.repositoryBoosts.highStars;
      } else if (stars > 100) {
        score += filters.github.repositoryBoosts.wellMaintained;
      }
      
      // Base score from stars (capped)
      score += Math.min(stars / 100, 30);
    }

    // Engagement scoring
    score += Math.min(issue.comments * 3, 30);

    // Reactions with higher weight
    if (issue.reactions) {
      score += Math.min(issue.reactions.total_count * 2, 20);
      score += Math.min(issue.reactions['+1'] * 3, 15);
    }

    // State-based scoring with problem type awareness
    if (issue.state === 'closed') {
      if (problemType === ProblemType.BUG_REPORT) {
        score += 15; // Closed bugs are likely resolved
      } else if (problemType === ProblemType.CONFIGURATION) {
        score += 10; // Closed config issues might have solutions
      } else {
        score += 5;
      }
    } else {
      // Open issues might be more relevant for ongoing problems
      if (problemType === ProblemType.BUG_REPORT) {
        score += 5;
      }
    }

    // Recency bonus for certain problem types
    const daysSinceUpdate = (Date.now() - new Date(issue.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    if (problemType === ProblemType.BUG_REPORT && daysSinceUpdate < 30) {
      score += 10;
    } else if (problemType === ProblemType.COMPATIBILITY && daysSinceUpdate < 90) {
      score += 8;
    }

    // Label-based scoring
    if (issue.labels) {
      const labelNames = issue.labels.map(l => l.name.toLowerCase());
      if (labelNames.includes('bug') && problemType === ProblemType.BUG_REPORT) {
        score += 10;
      }
      if (labelNames.includes('question') && problemType === ProblemType.CONFIGURATION) {
        score += 8;
      }
      if (labelNames.includes('performance') && problemType === ProblemType.PERFORMANCE) {
        score += 10;
      }
    }

    return Math.round(score);
  }
}