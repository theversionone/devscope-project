export enum ProblemType {
  CONFIGURATION = 'configuration',
  BUG_REPORT = 'bug',
  PERFORMANCE = 'performance', 
  COMPATIBILITY = 'compatibility',
  BEST_PRACTICE = 'practice',
  UNKNOWN = 'unknown'
}

export interface QueryAnalysis {
  originalQuery: string;
  problemType: ProblemType;
  technologies: string[];
  versions: string[];
  errorPatterns: string[];
  specificity: 'generic' | 'specific' | 'edge-case';
  searchStrategies: {
    github: GitHubSearchStrategy;
    stackoverflow: StackOverflowSearchStrategy;
    reddit: RedditSearchStrategy;
  };
}

export interface GitHubSearchStrategy {
  query: string;
  excludePatterns: string[];
  prioritizeTypes: string[];
  qualityThreshold: number;
}

export interface StackOverflowSearchStrategy {
  query: string;
  tags: string[];
  requireAnswered: boolean;
  sortBy: string;
}

export interface RedditSearchStrategy {
  query: string;
  subreddits: string[];
  excludeFlairs: string[];
  minEngagement: number;
}

export class QueryAnalyzer {
  private technologyPatterns!: Map<string, string[]>;
  private versionPatterns!: RegExp[];
  private errorPatterns!: RegExp[];
  private problemTypePatterns!: Map<ProblemType, RegExp[]>;

  constructor() {
    this.initializePatterns();
  }

  analyze(query: string): QueryAnalysis {
    const problemType = this.classifyProblemType(query);
    const technologies = this.extractTechnologies(query);
    const versions = this.extractVersions(query);
    const errorPatterns = this.extractErrorPatterns(query);
    const specificity = this.assessSpecificity(query, technologies, versions);

    return {
      originalQuery: query,
      problemType,
      technologies,
      versions,
      errorPatterns,
      specificity,
      searchStrategies: this.generateSearchStrategies(query, problemType, technologies, versions)
    };
  }

  private initializePatterns(): void {
    this.technologyPatterns = new Map([
      ['react', ['react', 'reactjs', 'jsx', 'tsx']],
      ['next.js', ['next.js', 'nextjs', 'next', 'vercel']],
      ['vue', ['vue', 'vuejs', 'vue.js']],
      ['angular', ['angular', 'angularjs']],
      ['node.js', ['node.js', 'nodejs', 'node']],
      ['typescript', ['typescript', 'ts']],
      ['javascript', ['javascript', 'js']],
      ['vite', ['vite', 'vitejs']],
      ['webpack', ['webpack']],
      ['docker', ['docker', 'dockerfile']],
      ['prisma', ['prisma']],
      ['mongodb', ['mongodb', 'mongo']],
      ['postgresql', ['postgresql', 'postgres']],
      ['redis', ['redis']],
      ['aws', ['aws', 'amazon web services']],
      ['kubernetes', ['kubernetes', 'k8s']],
      ['python', ['python']],
      ['django', ['django']],
      ['flask', ['flask']],
      ['git', ['git', 'github', 'gitlab']]
    ]);

    this.versionPatterns = [
      /v?(\d+\.\d+(?:\.\d+)?)/g,
      /(?:version|ver)\s*(\d+\.\d+(?:\.\d+)?)/gi,
      /(react\s+\d+)/gi,
      /(node\s+\d+)/gi,
      /(next\.?js\s+\d+)/gi
    ];

    this.errorPatterns = [
      /error/gi,
      /exception/gi,
      /failed/gi,
      /crash/gi,
      /memory\s+leak/gi,
      /not\s+working/gi,
      /broken/gi,
      /issue/gi,
      /problem/gi,
      /bug/gi
    ];

    this.problemTypePatterns = new Map([
      [ProblemType.CONFIGURATION, [
        /config/gi,
        /setup/gi,
        /install/gi,
        /configure/gi,
        /settings/gi,
        /\.config\./gi,
        /environment/gi
      ]],
      [ProblemType.BUG_REPORT, [
        /bug/gi,
        /error/gi,
        /crash/gi,
        /exception/gi,
        /broken/gi,
        /not\s+working/gi,
        /fails?/gi,
        /infinite\s+loop/gi,
        /hanging/gi,
        /freeze/gi,
        /stuck/gi
      ]],
      [ProblemType.PERFORMANCE, [
        /performance/gi,
        /slow/gi,
        /speed/gi,
        /memory\s+leak/gi,
        /optimization/gi,
        /lag/gi,
        /benchmark/gi
      ]],
      [ProblemType.COMPATIBILITY, [
        /compatibility/gi,
        /version/gi,
        /upgrade/gi,
        /migration/gi,
        /deprecated/gi,
        /breaking\s+change/gi
      ]],
      [ProblemType.BEST_PRACTICE, [
        /how\s+to/gi,
        /best\s+practice/gi,
        /recommended/gi,
        /should\s+i/gi,
        /proper\s+way/gi,
        /correct\s+way/gi
      ]]
    ]);
  }

  private classifyProblemType(query: string): ProblemType {
    const scores = new Map<ProblemType, number>();

    // Calculate base scores for each problem type
    for (const [type, patterns] of this.problemTypePatterns) {
      let score = 0;
      for (const pattern of patterns) {
        const matches = query.match(pattern);
        if (matches) {
          score += matches.length;
        }
      }
      scores.set(type, score);
    }

    // Apply priority rules for overlapping patterns
    const performanceScore = scores.get(ProblemType.PERFORMANCE) || 0;
    const configScore = scores.get(ProblemType.CONFIGURATION) || 0;

    // Performance issues take priority over bugs for memory/speed related terms
    if (performanceScore > 0 && /memory|leak|performance|slow|speed|optimization/gi.test(query)) {
      scores.set(ProblemType.PERFORMANCE, performanceScore + 2);
    }

    // Configuration issues take priority when setup/config terms are strong
    if (configScore > 0 && /setup|configure|config|install|environment/gi.test(query)) {
      scores.set(ProblemType.CONFIGURATION, configScore + 1);
    }

    // Find the highest scoring type
    let bestType = ProblemType.UNKNOWN;
    let bestScore = 0;

    for (const [type, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    return bestScore > 0 ? bestType : ProblemType.UNKNOWN;
  }

  private extractTechnologies(query: string): string[] {
    const found: string[] = [];
    const queryLower = query.toLowerCase();

    for (const [tech, aliases] of this.technologyPatterns) {
      for (const alias of aliases) {
        if (queryLower.includes(alias.toLowerCase())) {
          found.push(tech);
          break;
        }
      }
    }

    return [...new Set(found)];
  }

  private extractVersions(query: string): string[] {
    const versions: string[] = [];

    for (const pattern of this.versionPatterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        versions.push(match[1] || match[0]);
      }
    }

    return [...new Set(versions)];
  }

  private extractErrorPatterns(query: string): string[] {
    const patterns: string[] = [];

    for (const pattern of this.errorPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        patterns.push(...matches);
      }
    }

    return [...new Set(patterns)];
  }

  private assessSpecificity(query: string, technologies: string[], versions: string[]): 'generic' | 'specific' | 'edge-case' {
    const wordCount = query.split(/\s+/).length;
    const techCount = technologies.length;
    const versionCount = versions.length;

    if (wordCount < 4 && techCount <= 1) {
      return 'generic';
    }

    if (techCount >= 2 || versionCount >= 1 || wordCount > 8) {
      return 'edge-case';
    }

    return 'specific';
  }

  private generateSearchStrategies(
    query: string, 
    problemType: ProblemType, 
    technologies: string[], 
    _versions: string[]
  ): QueryAnalysis['searchStrategies'] {
    return {
      github: this.generateGitHubStrategy(query, problemType, technologies, _versions),
      stackoverflow: this.generateStackOverflowStrategy(query, problemType, technologies),
      reddit: this.generateRedditStrategy(query, problemType, technologies)
    };
  }

  private generateGitHubStrategy(
    query: string, 
    problemType: ProblemType, 
    technologies: string[], 
    _versions: string[]
  ): GitHubSearchStrategy {
    let searchQuery = query;
    const excludePatterns = [
      '-author:dependabot',
      '-author:renovate[bot]',
      '-author:github-actions[bot]',
      '-label:dependencies'
    ];

    const prioritizeTypes = ['type:issue'];
    
    if (problemType === ProblemType.BUG_REPORT) {
      prioritizeTypes.push('label:bug');
      excludePatterns.push('-label:enhancement');
    } else if (problemType === ProblemType.CONFIGURATION) {
      prioritizeTypes.push('label:question', 'label:help');
    }

    // Add technology-specific repository targeting
    if (technologies.length > 0) {
      const repoHints = this.getRepositoryHints(technologies);
      if (repoHints.length > 0) {
        searchQuery = `${query} ${repoHints.join(' OR ')}`;
      }
    }

    return {
      query: searchQuery,
      excludePatterns,
      prioritizeTypes,
      qualityThreshold: problemType === ProblemType.BUG_REPORT ? 2 : 1
    };
  }

  private generateStackOverflowStrategy(
    query: string, 
    problemType: ProblemType, 
    technologies: string[]
  ): StackOverflowSearchStrategy {
    const tags = technologies.filter(tech => 
      ['javascript', 'typescript', 'react', 'node.js', 'python', 'java'].includes(tech)
    );

    return {
      query,
      tags,
      requireAnswered: problemType === ProblemType.CONFIGURATION || problemType === ProblemType.BEST_PRACTICE,
      sortBy: problemType === ProblemType.BUG_REPORT ? 'activity' : 'relevance'
    };
  }

  private generateRedditStrategy(
    query: string, 
    problemType: ProblemType, 
    technologies: string[]
  ): RedditSearchStrategy {
    const subreddits = this.getRelevantSubreddits(technologies, problemType);
    const excludeFlairs = [
      'Showcase',
      'Career',
      'Show and Tell',
      'Beginner Question'
    ];

    if (problemType === ProblemType.BEST_PRACTICE) {
      excludeFlairs.push('Rant');
    }

    return {
      query,
      subreddits,
      excludeFlairs,
      minEngagement: problemType === ProblemType.BUG_REPORT ? 5 : 10
    };
  }

  private getRepositoryHints(technologies: string[]): string[] {
    const repoMap: Record<string, string> = {
      'react': 'repo:facebook/react',
      'next.js': 'repo:vercel/next.js',
      'vite': 'repo:vitejs/vite',
      'vue': 'repo:vuejs/vue',
      'angular': 'repo:angular/angular',
      'typescript': 'repo:microsoft/TypeScript',
      'prisma': 'repo:prisma/prisma'
    };

    return technologies
      .map(tech => repoMap[tech])
      .filter(Boolean);
  }

  private getRelevantSubreddits(technologies: string[], problemType: ProblemType): string[] {
    const subreddits = new Set<string>();

    // Technology-specific subreddits
    const techSubreddits: Record<string, string[]> = {
      'react': ['reactjs', 'reactnative'],
      'next.js': ['nextjs', 'reactjs'],
      'vue': ['vuejs'],
      'angular': ['angular', 'angularjs'],
      'node.js': ['node', 'nodejs'],
      'javascript': ['javascript', 'webdev'],
      'typescript': ['typescript'],
      'python': ['python', 'learnpython'],
      'docker': ['docker', 'devops']
    };

    technologies.forEach(tech => {
      const subs = techSubreddits[tech];
      if (subs) {
        subs.forEach(sub => subreddits.add(sub));
      }
    });

    // Add general programming subreddits based on problem type
    if (problemType === ProblemType.BUG_REPORT || problemType === ProblemType.CONFIGURATION) {
      subreddits.add('programming');
      subreddits.add('askprogramming');
    }

    if (problemType === ProblemType.BEST_PRACTICE) {
      subreddits.add('codereview');
      subreddits.add('programming');
    }

    // Fallback to general subreddits if none found
    if (subreddits.size === 0) {
      ['programming', 'webdev', 'askprogramming'].forEach(sub => subreddits.add(sub));
    }

    return Array.from(subreddits).slice(0, 5);
  }
}