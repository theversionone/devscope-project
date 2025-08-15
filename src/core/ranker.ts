import { NormalizedResult, RankedResult } from '../types/index.js';
import { ProblemType } from './queryAnalyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load filter configuration
const filtersPath = path.join(__dirname, '../config/filters.json');
const filters = JSON.parse(fs.readFileSync(filtersPath, 'utf-8'));

export class ResultRanker {
  private query: string;
  private problemType?: ProblemType;

  constructor(query: string, problemType?: ProblemType) {
    this.query = query.toLowerCase();
    this.problemType = problemType;
  }

  rankResults(results: NormalizedResult[]): RankedResult[] {
    return results.map(result => {
      const relevanceScore = this.calculateRelevanceScore(result);
      const recencyScore = this.calculateRecencyScore(result);
      const communityScore = this.calculateCommunityScore(result);
      const sourceScore = this.calculateSourceScore(result);

      // Problem-type aware weighted scoring
      const weights = this.getScoreWeights();
      const acceptedBonus = this.getAcceptedBonus(result);
      
      const finalScore = 
        relevanceScore * weights.relevance +
        recencyScore * weights.recency +
        communityScore * weights.community +
        acceptedBonus +
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

    // Problem-type aware recency scoring
    if (this.problemType === ProblemType.BUG_REPORT || this.problemType === ProblemType.COMPATIBILITY) {
      // More aggressive recency for bugs and compatibility issues
      if (daysSince < 7) return 100;
      if (daysSince < 30) return 85;
      if (daysSince < 90) return 60;
      if (daysSince < 180) return 30;
      if (daysSince < 365) return 15;
      return 5;
    } else if (this.problemType === ProblemType.BEST_PRACTICE) {
      // Best practices can be older and still valuable
      if (daysSince < 30) return 100;
      if (daysSince < 180) return 90;
      if (daysSince < 365) return 80;
      if (daysSince < 730) return 70;
      if (daysSince < 1095) return 50; // 3 years
      return 30;
    }
    
    // Default scoring
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

  private getScoreWeights(): { relevance: number; recency: number; community: number } {
    if (!this.problemType) {
      // Default weights
      return { relevance: 0.35, recency: 0.25, community: 0.20 };
    }
    
    const weights = filters.global.problemTypeWeights[this.problemType];
    if (weights) {
      return weights;
    }
    
    // Fallback to default
    return { relevance: 0.35, recency: 0.25, community: 0.20 };
  }
  
  private getAcceptedBonus(result: NormalizedResult): number {
    if (!result.isAccepted) {
      return 0;
    }
    
    // Higher bonus for accepted answers in configuration/practice queries
    if (this.problemType === ProblemType.CONFIGURATION || this.problemType === ProblemType.BEST_PRACTICE) {
      return 20;
    } else if (this.problemType === ProblemType.BUG_REPORT) {
      return 15;
    }
    
    return 12; // Default bonus
  }

  private calculateSourceScore(result: NormalizedResult): number {
    // Problem-type aware source scoring
    if (this.problemType) {
      const sourceWeights = filters.global.sourceWeights[this.problemType];
      if (sourceWeights && sourceWeights[result.source]) {
        return sourceWeights[result.source] * 100;
      }
    }
    
    // Fallback to legacy scoring
    const isBugQuery = /bug|issue|error|fix|problem/i.test(this.query);
    const isHowToQuery = /how to|how do|what is|explain/i.test(this.query);

    if (result.source === 'stackoverflow' && isHowToQuery) {
      return 100;
    } else if (result.source === 'github' && isBugQuery) {
      return 100;
    }

    return 50;
  }
}