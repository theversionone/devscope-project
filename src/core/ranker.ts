import { NormalizedResult, RankedResult } from '../types/index.js';

export class ResultRanker {
  private query: string;

  constructor(query: string) {
    this.query = query.toLowerCase();
  }

  rankResults(results: NormalizedResult[]): RankedResult[] {
    return results.map(result => {
      const relevanceScore = this.calculateRelevanceScore(result);
      const recencyScore = this.calculateRecencyScore(result);
      const communityScore = this.calculateCommunityScore(result);
      const sourceScore = this.calculateSourceScore(result);

      // Weighted scoring: 35% relevance, 25% recency, 20% community, 15% accepted, 5% source
      const finalScore = 
        relevanceScore * 0.35 +
        recencyScore * 0.25 +
        communityScore * 0.20 +
        (result.isAccepted ? 15 : 0) +
        sourceScore * 0.05;

      return {
        ...result,
        relevanceScore,
        recencyScore,
        communityScore,
        finalScore,
      };
    }).sort((a, b) => b.finalScore - a.finalScore);
  }

  private calculateRelevanceScore(result: NormalizedResult): number {
    const queryWords = this.query.split(/\s+/);
    const titleLower = result.title.toLowerCase();
    const contentLower = result.content.toLowerCase();

    let score = 0;

    // Title matches are worth more
    queryWords.forEach(word => {
      if (titleLower.includes(word)) {
        score += 10;
      }
      if (contentLower.includes(word)) {
        score += 2;
      }
    });

    // Exact phrase match in title
    if (titleLower.includes(this.query)) {
      score += 20;
    }

    // Tag matches
    result.tags.forEach(tag => {
      if (this.query.includes(tag.toLowerCase()) || tag.toLowerCase().includes(this.query)) {
        score += 5;
      }
    });

    // Normalize to 0-100
    return Math.min(score, 100);
  }

  private calculateRecencyScore(result: NormalizedResult): number {
    const now = Date.now();
    const created = result.createdAt.getTime();
    const updated = result.updatedAt?.getTime() || created;
    
    // Use the more recent date
    const relevantDate = Math.max(created, updated);
    const daysSince = (now - relevantDate) / (1000 * 60 * 60 * 24);

    // Score decreases with age
    if (daysSince < 7) return 100;
    if (daysSince < 30) return 80;
    if (daysSince < 90) return 60;
    if (daysSince < 365) return 40;
    if (daysSince < 730) return 20;
    return 10;
  }

  private calculateCommunityScore(result: NormalizedResult): number {
    let score = 0;

    // Base score from votes/reactions
    score += Math.min(result.voteCount || 0, 50);

    // Bonus for high overall score
    score += Math.min(result.score / 2, 25);

    // Bonus for accepted/resolved status
    if (result.isAccepted) {
      score += 25;
    }

    // Normalize to 0-100
    return Math.min(score, 100);
  }

  private calculateSourceScore(result: NormalizedResult): number {
    // Slight preference for Stack Overflow for Q&A-style queries
    // Slight preference for GitHub for bug/issue-style queries
    
    const isBugQuery = /bug|issue|error|fix|problem/i.test(this.query);
    const isHowToQuery = /how to|how do|what is|explain/i.test(this.query);

    if (result.source === 'stackoverflow' && isHowToQuery) {
      return 100;
    } else if (result.source === 'github' && isBugQuery) {
      return 100;
    }

    // Default equal weight
    return 50;
  }
}