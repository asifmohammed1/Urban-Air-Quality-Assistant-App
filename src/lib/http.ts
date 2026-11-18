export class HttpFetchError extends Error {
  readonly status: number;
  readonly isQuotaExceeded: boolean;

  constructor(message: string, status: number, isQuotaExceeded = false) {
    super(message);
    this.name = 'HttpFetchError';
    this.status = status;
    this.isQuotaExceeded = isQuotaExceeded;
  }
}

/**
 * Safely fetches and parses JSON responses, defending against HTML fallback pages
 * (e.g., proxy 502/404 pages starting with '<html>') that would otherwise crash JSON.parse.
 */
export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (!contentType.includes('application/json')) {
    const trimmed = rawText.trim();
    if (trimmed.startsWith('<')) {
      throw new HttpFetchError(
        `Service temporarily returned an HTML error page (HTTP ${response.status}). Please retry.`,
        response.status,
        response.status === 429
      );
    }
  }

  let parsed: unknown = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new HttpFetchError(
        `Received unreadable server response (HTTP ${response.status}). Please retry.`,
        response.status,
        response.status === 429
      );
    }
  }

  if (!response.ok) {
    const errObj = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      error?: string;
      isQuotaExceeded?: boolean;
    };
    const isQuotaExceeded = Boolean(errObj.isQuotaExceeded);
    if (isQuotaExceeded) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    throw new HttpFetchError(
      errObj.error || `Request failed with status ${response.status}.`,
      response.status,
      isQuotaExceeded
    );
  }

  return parsed as T;
}
