import Bottleneck from 'bottleneck';

// Create rate limiters for each API source
export const stackOverflowLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 600, // 100 requests per minute = 600ms between requests
  reservoir: 100, // 100 requests
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000, // per minute
});

export const githubLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 100, // Allow faster requests but track points
  reservoir: 5000, // 5000 points per hour
  reservoirRefreshAmount: 5000,
  reservoirRefreshInterval: 60 * 60 * 1000, // per hour
});

export const redditLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000, // 60 requests per minute = 1000ms between requests
  reservoir: 60, // 60 requests
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60 * 1000, // per minute
});

// Helper function for exponential backoff
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a rate limit error
      if (error instanceof Error && error.message.includes('429')) {
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
        console.error(`Rate limited, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}