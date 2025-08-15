import axios from 'axios';
import { NormalizedResult, CodeSnippet } from '../types/index.js';
import { githubLimiter, withRetry } from '../utils/rateLimiter.js';
import { handleAPIError } from '../utils/errorHandler.js';

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

  async search(query: string, maxResults = 5): Promise<NormalizedResult[]> {
    try {
      return await githubLimiter.schedule(() =>
        withRetry(() => this.performSearch(query, maxResults))
      );
    } catch (error) {
      handleAPIError(error, 'GitHub');
      return [];
    }
  }

  private async performSearch(query: string, maxResults: number): Promise<NormalizedResult[]> {
    try {
      // Search for issues and pull requests
      const searchQuery = `${query} in:title,body is:public`;
      const response = await axios.get(`${BASE_URL}/search/issues`, {
        headers: this.headers,
        params: {
          q: searchQuery,
          sort: 'reactions',
          order: 'desc',
          per_page: maxResults,
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

      return this.normalizeResults(issues, repoCache);
    } catch (error) {
      console.error('GitHub search error:', error);
      throw error;
    }
  }

  private normalizeResults(issues: GitHubIssue[], repoCache: Map<string, GitHubRepo>): NormalizedResult[] {
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
        score: this.calculateScore(issue, repo),
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

  private calculateScore(issue: GitHubIssue, repo?: GitHubRepo): number {
    let score = 0;

    // Repository stars contribute to score
    if (repo) {
      score += Math.min(repo.stargazers_count / 100, 50);
    }

    // Comments indicate engagement
    score += Math.min(issue.comments * 2, 20);

    // Reactions
    if (issue.reactions) {
      score += issue.reactions.total_count;
    }

    // Closed issues often mean resolved
    if (issue.state === 'closed') {
      score += 10;
    }

    return Math.round(score);
  }
}