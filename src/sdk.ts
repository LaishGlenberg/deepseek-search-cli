/**
 * Library entry point for `import ... from 'deepseek-search-cli'`.
 *
 * `src/index.ts` is the `dsearch` binary; this module is the package `exports`
 * entry, so importing the package never runs the CLI. Both are thin wrappers over
 * the same `client.ts` / `config.ts` / `usage.ts` code the CLI uses, so behavior,
 * errors, and cost tracking stay identical.
 */
import { createClient, type DeepSeekClient, type SearchOptions } from './client.js';
import { DEFAULT_BASE_URL, loadConfig } from './config.js';
import type { FetchResponse, SearchResponse } from './types.js';
import { recordUsage } from './usage.js';

export { createClient, DeepSeekApiError } from './client.js';
export type { ClientOptions, DeepSeekClient, SearchOptions } from './client.js';
export { ConfigError } from './config.js';
export { readUsage, recordUsage, summarizeUsage, usagePath } from './usage.js';
export type { FetchResponse, SearchRequest, SearchResponse, SearchResult } from './types.js';
export { VERSION } from './version.js';

export interface DsearchOptions {
  /** API key. Defaults to the same lookup the CLI uses: env, `./.env`, then `dsearch auth`. */
  apiKey?: string;
  /** API base URL. Defaults to `DEEPSEEK_BASE_URL`, then the public API. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Environment used for key and base URL lookup. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Directory whose `.env` is read. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Record billable requests in `usage.jsonl` so `dsearch cost` stays accurate (default true). */
  trackUsage?: boolean;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
}

/** Config-resolved search and fetch, recording usage like the CLI does. */
export interface Dsearch {
  /** Search the web. Billable when the API returns at least one result. */
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  /** Fetch a page as Markdown. Billable when the API returns page content. */
  fetchPage(url: string): Promise<FetchResponse>;
}

function resolveBaseUrl(
  options: DsearchOptions,
  env: NodeJS.ProcessEnv,
  fromConfig: string | undefined,
): string {
  const envBaseUrl = env.DEEPSEEK_BASE_URL?.trim();
  return options.baseUrl ?? fromConfig ?? (envBaseUrl || DEFAULT_BASE_URL);
}

/**
 * Create an isolated client. The API key is resolved lazily on first request, so
 * constructing an instance never touches the filesystem or throws.
 */
export function createDsearch(options: DsearchOptions = {}): Dsearch {
  const env = options.env ?? process.env;
  const trackUsage = options.trackUsage ?? true;
  let client: DeepSeekClient | undefined;

  function resolveClient(): DeepSeekClient {
    if (client) return client;

    // An explicit key skips env/.env/config-file lookup; the base URL still falls
    // back to DEEPSEEK_BASE_URL so the instance matches the CLI's targeting.
    const loaded = options.apiKey ? undefined : loadConfig(env, options.cwd);
    const apiKey = options.apiKey ?? loaded?.apiKey;
    if (!apiKey) throw new Error('unreachable: loadConfig returns a key or throws');

    client = createClient({
      apiKey,
      baseUrl: resolveBaseUrl(options, env, loaded?.baseUrl),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    return client;
  }

  return {
    async search(query, searchOptions) {
      const response = await resolveClient().search(query, searchOptions);
      // DeepSeek bills only successful requests that produce a result.
      if (trackUsage && response.results.length > 0) recordUsage('search', { env });
      return response;
    },

    async fetchPage(url) {
      const page = await resolveClient().fetchPage(url);
      // DeepSeek bills a fetch only when it returns page content.
      if (trackUsage && page.content.trim()) recordUsage('fetch', { env });
      return page;
    },
  };
}

let shared: Dsearch | undefined;

function sharedClient(): Dsearch {
  shared ??= createDsearch();
  return shared;
}

/** Search with the shared instance. See {@link createDsearch} for per-call overrides. */
export function search(query: string, options?: SearchOptions): Promise<SearchResponse> {
  return sharedClient().search(query, options);
}

/** Fetch a page with the shared instance. See {@link createDsearch} for overrides. */
export function fetchPage(url: string): Promise<FetchResponse> {
  return sharedClient().fetchPage(url);
}
