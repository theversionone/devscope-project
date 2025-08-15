export class APIError extends Error {
  constructor(
    message: string,
    public source: string,
    public statusCode?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export function handleAPIError(error: any, source: string): void {
  console.error(`[${source}] Error:`, error.message || error);
  
  if (error.response) {
    const status = error.response.status;
    const retryAfter = error.response.headers?.['retry-after'];
    
    if (status === 429) {
      throw new APIError(
        `Rate limit exceeded for ${source}`,
        source,
        status,
        retryAfter ? parseInt(retryAfter) : undefined
      );
    } else if (status === 401) {
      throw new APIError(
        `Authentication failed for ${source}. Check your API key.`,
        source,
        status
      );
    } else if (status >= 500) {
      throw new APIError(
        `${source} service is temporarily unavailable`,
        source,
        status
      );
    }
  }
  
  throw new APIError(
    `Failed to fetch from ${source}: ${error.message}`,
    source
  );
}

export async function withFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackValue: T,
  source: string
): Promise<T> {
  try {
    return await primaryFn();
  } catch (error) {
    console.error(`[${source}] Falling back due to error:`, error);
    return fallbackValue;
  }
}