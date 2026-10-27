import { DEFAULT_BASE_URL } from './config.js';
import type { ApiErrorBody, FetchResponse, SearchRequest, SearchResponse } from './types.js';
import { VERSION } from './version.js';

export class DeepSeekApiError extends Error {
  /** HTTP status, or 0 for network and timeout failures. */
  readonly status: number;
  /** Error code from the API response body, when present. */
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'DeepSeekApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
}

export interface SearchOptions {
  count?: number;
  oriQuestion?: string;
  localization?: string;
  needContent?: boolean;
}

export interface DeepSeekClient {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  fetchPage(url: string): Promise<FetchResponse>;
}

function errorFromBody(body: unknown): ApiErrorBody['error'] | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;

  const { message, code } = error as { message?: unknown; code?: unknown };
  if (typeof message !== 'string') return undefined;
  return { message, code: typeof code === 'string' ? code : undefined };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createClient(options: ClientOptions): DeepSeekClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': `deepseek-search-cli/${VERSION}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new DeepSeekApiError(0, `Request to ${path} timed out after ${timeoutMs}ms.`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new DeepSeekApiError(0, `Could not reach the DeepSeek API: ${detail}`);
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      const apiError = errorFromBody(parsed);
      const fallback = text.trim() || response.statusText || 'Unknown error';
      const message = apiError?.message ?? fallback;
      throw new DeepSeekApiError(
        response.status,
        `DeepSeek API error (${response.status}): ${message}`,
        apiError?.code,
      );
    }

    if (parsed === undefined) {
      throw new DeepSeekApiError(response.status, 'DeepSeek API returned a malformed JSON response.');
    }

    return parsed as T;
  }

  return {
    async search(query, searchOptions = {}) {
      const request: SearchRequest = { query };
      if (searchOptions.count !== undefined) request.count = searchOptions.count;
      if (searchOptions.oriQuestion) request.ori_question = searchOptions.oriQuestion;
      if (searchOptions.localization) request.localization = searchOptions.localization;
      if (searchOptions.needContent) request.need_content = true;
      return post<SearchResponse>('/v1/tools/search', request);
    },

    async fetchPage(url) {
      return post<FetchResponse>('/v1/tools/fetch', { url });
    },
  };
}
