import { RankedResult, GatherContextResult, Citation, CodeSnippet } from '../types/index.js';

export class ResultAggregator {
  aggregateResults(
    results: RankedResult[],
    elapsedMs: number,
    cacheHits: number,
    incompleteSources?: string[]
  ): GatherContextResult {
    // Take top results
    const topResults = results.slice(0, 10);

    // Generate summary
    const summary = this.generateSummary(topResults);

    // Extract highlights
    const highlights = this.extractHighlights(topResults);

    // Create citations
    const citations = this.createCitations(topResults);

    // Collect code snippets
    const snippets = this.collectCodeSnippets(topResults);

    // Calculate source counts
    const sourceCounts = this.calculateSourceCounts(results);

    return {
      summary,
      highlights,
      citations,
      snippets,
      stats: {
        elapsedMs,
        sourceCounts,
        cacheHits,
        incompleteSources,
      },
    };
  }

  private generateSummary(results: RankedResult[]): string {
    if (results.length === 0) {
      return 'No relevant results found for your query.';
    }

    const topResult = results[0];
    const hasAcceptedAnswer = results.some(r => r.isAccepted);
    const sources = [...new Set(results.map(r => r.source))];

    let summary = `Found ${results.length} relevant results from ${sources.join(' and ')}. `;

    if (hasAcceptedAnswer) {
      const acceptedResults = results.filter(r => r.isAccepted);
      summary += `${acceptedResults.length} result(s) have accepted/verified solutions. `;
    }

    if (topResult.finalScore > 80) {
      summary += `The top result "${topResult.title}" appears highly relevant with a score of ${Math.round(topResult.finalScore)}. `;
    }

    // Add version information if present
    const versionsFound = results
      .filter(r => r.version)
      .map(r => r.version)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (versionsFound.length > 0) {
      summary += `Version-specific information found for: ${versionsFound.join(', ')}. `;
    }

    return summary.trim();
  }

  private extractHighlights(results: RankedResult[]): string[] {
    const highlights: string[] = [];

    // Add top solutions/answers
    results.slice(0, 3).forEach(result => {
      if (result.isAccepted) {
        highlights.push(`✓ ${result.title} (${result.source})`);
      } else {
        highlights.push(`• ${result.title} (${result.source})`);
      }
    });

    // Add version-specific highlights
    const versionSpecific = results.filter(r => r.version);
    if (versionSpecific.length > 0) {
      versionSpecific.slice(0, 2).forEach(result => {
        highlights.push(`📌 Version ${result.version}: ${result.title}`);
      });
    }

    // Add high-score highlights
    const highScore = results.filter(r => r.finalScore > 70 && !highlights.some(h => h.includes(r.title)));
    highScore.slice(0, 2).forEach(result => {
      highlights.push(`⭐ High relevance: ${result.title}`);
    });

    return highlights.slice(0, 5);
  }

  private createCitations(results: RankedResult[]): Citation[] {
    return results.slice(0, 5).map(result => ({
      title: result.title,
      url: result.url,
      source: result.source,
      author: result.author,
      createdAt: result.createdAt.toISOString(),
      score: Math.round(result.finalScore),
      version: result.version,
      snippet: this.extractSnippet(result.content),
    }));
  }

  private extractSnippet(content: string): string {
    // Remove code blocks for snippet
    const withoutCode = content.replace(/```[\s\S]*?```/g, '[code]');
    
    // Take first meaningful paragraph
    const paragraphs = withoutCode.split('\n\n').filter(p => p.trim().length > 50);
    
    if (paragraphs.length > 0) {
      const snippet = paragraphs[0].substring(0, 200);
      return snippet + (snippet.length < paragraphs[0].length ? '...' : '');
    }

    // Fallback to first 200 chars
    return content.substring(0, 200) + '...';
  }

  private collectCodeSnippets(results: RankedResult[]): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    const seenCode = new Set<string>();

    results.forEach(result => {
      result.codeSnippets.forEach(snippet => {
        const codeKey = snippet.code.trim();
        
        // Avoid duplicates and very short snippets
        if (!seenCode.has(codeKey) && snippet.code.length > 20) {
          seenCode.add(codeKey);
          snippets.push(snippet);
        }
      });
    });

    // Return top 5 unique snippets
    return snippets.slice(0, 5);
  }

  private calculateSourceCounts(results: RankedResult[]): Record<string, number> {
    const counts: Record<string, number> = {};

    results.forEach(result => {
      counts[result.source] = (counts[result.source] || 0) + 1;
    });

    return counts;
  }
}