import axios from 'axios';
import { NormalizedResult, CodeSnippet } from '../types/index.js';
import { stackOverflowLimiter, withRetry } from '../utils/rateLimiter.js';
import { handleAPIError } from '../utils/errorHandler.js';

const BASE_URL = 'https://api.stackexchange.com/2.3';

interface StackOverflowQuestion {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  creation_date: number;
  last_activity_date: number;
  tags: string[];
  owner: {
    display_name: string;
    reputation: number;
  };
  accepted_answer_id?: number;
  body?: string;
}

interface StackOverflowAnswer {
  answer_id: number;
  question_id: number;
  score: number;
  is_accepted: boolean;
  creation_date: number;
  owner: {
    display_name: string;
    reputation: number;
  };
  body?: string;
}

export class StackOverflowAdapter {
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.STACKOVERFLOW_KEY;
  }

  async search(query: string, maxResults = 5): Promise<NormalizedResult[]> {
    try {
      return await stackOverflowLimiter.schedule(() =>
        withRetry(() => this.performSearch(query, maxResults))
      );
    } catch (error) {
      console.error('Stack Overflow search error:', error);
      try {
        handleAPIError(error, 'Stack Overflow');
      } catch (apiError) {
        console.error('Stack Overflow API error handled:', apiError);
      }
      return [];
    }
  }

  private async performSearch(query: string, maxResults: number): Promise<NormalizedResult[]> {
    const params: any = {
      q: query,
      order: 'desc',
      sort: 'relevance',
      site: 'stackoverflow',
      filter: 'withbody',
      pagesize: maxResults,
    };

    if (this.apiKey) {
      params.key = this.apiKey;
    }

    console.log('Stack Overflow search params:', { q: params.q, pagesize: params.pagesize });
    const response = await axios.get(`${BASE_URL}/search/advanced`, { params });
    const questions = response.data.items || [];
    console.log(`Stack Overflow found ${questions.length} results`);

    // Get answers for questions with accepted answers
    const questionsWithAnswers = await this.fetchAnswersForQuestions(
      questions.filter((q: StackOverflowQuestion) => q.accepted_answer_id)
    );

    return this.normalizeResults(questions, questionsWithAnswers);
  }

  private async fetchAnswersForQuestions(
    questions: StackOverflowQuestion[]
  ): Promise<Map<number, StackOverflowAnswer>> {
    if (questions.length === 0) {
      return new Map();
    }

    const answerIds = questions
      .filter(q => q.accepted_answer_id)
      .map(q => q.accepted_answer_id)
      .join(';');

    if (!answerIds) {
      return new Map();
    }

    try {
      const params: any = {
        site: 'stackoverflow',
        filter: 'withbody',
      };

      if (this.apiKey) {
        params.key = this.apiKey;
      }

      const response = await axios.get(`${BASE_URL}/answers/${answerIds}`, { params });
      const answers = response.data.items || [];

      const answerMap = new Map<number, StackOverflowAnswer>();
      answers.forEach((answer: StackOverflowAnswer) => {
        answerMap.set(answer.answer_id, answer);
      });

      return answerMap;
    } catch (error) {
      console.error('Failed to fetch answers:', error);
      return new Map();
    }
  }

  private normalizeResults(
    questions: StackOverflowQuestion[],
    answers: Map<number, StackOverflowAnswer>
  ): NormalizedResult[] {
    return questions.map(question => {
      const acceptedAnswer = question.accepted_answer_id
        ? answers.get(question.accepted_answer_id)
        : undefined;

      const content = this.buildContent(question, acceptedAnswer);
      const codeSnippets = this.extractCodeSnippets(content);

      return {
        title: question.title,
        url: question.link,
        source: 'stackoverflow' as const,
        author: question.owner?.display_name || 'Anonymous',
        createdAt: new Date(question.creation_date * 1000),
        updatedAt: new Date(question.last_activity_date * 1000),
        score: question.score,
        content,
        codeSnippets,
        tags: question.tags || [],
        isAccepted: !!acceptedAnswer?.is_accepted,
        voteCount: question.score + (acceptedAnswer?.score || 0),
      };
    });
  }

  private buildContent(
    question: StackOverflowQuestion,
    answer?: StackOverflowAnswer
  ): string {
    let content = '';

    if (question.body) {
      content += this.stripHtml(question.body);
    }

    if (answer?.body) {
      content += '\n\n--- ACCEPTED ANSWER ---\n\n';
      content += this.stripHtml(answer.body);
    }

    return content;
  }

  private extractCodeSnippets(content: string): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const inlineCodeRegex = /<code>([\s\S]*?)<\/code>/g;

    let match;

    // Extract fenced code blocks
    while ((match = codeBlockRegex.exec(content)) !== null) {
      snippets.push({
        language: match[1] || 'plaintext',
        code: match[2].trim(),
      });
    }

    // Extract inline code blocks from HTML
    while ((match = inlineCodeRegex.exec(content)) !== null) {
      const code = this.stripHtml(match[1]).trim();
      if (code.includes('\n') || code.length > 50) {
        snippets.push({
          language: 'plaintext',
          code,
        });
      }
    }

    return snippets;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<pre><code>/g, '```\n')
      .replace(/<\/code><\/pre>/g, '\n```')
      .replace(/<code>/g, '`')
      .replace(/<\/code>/g, '`')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n\s*\n\s*\n/g, '\n\n');
  }
}