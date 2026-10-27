/** Request and response shapes for DeepSeek's Search and Fetch APIs. */

export interface SearchRequest {
  /** Search query, 1-128 Unicode characters. Supports operators such as `site:`. */
  query: string;
  /** Number of results to return (1-50, API default 10). */
  count?: number;
  /** The user's original question, used to improve query understanding. */
  ori_question?: string;
  /** Optional IP address used to localize results. */
  localization?: string;
  /** Whether to include full page content in each result. */
  need_content?: boolean;
}

export interface SearchResult {
  /** Relevance score from 0 to 3; >= 1.5 is considered high quality. */
  rerank_score: number;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  site_icon: string | null;
  /** RFC 3339 publication time in UTC, or null when unknown. */
  date: string | null;
  /** Authority tier 0-4; -1 means unknown. */
  authority: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface FetchRequest {
  /** HTTP(S) URL, at most 8192 characters. */
  url: string;
}

export interface FetchResponse {
  title: string;
  /** Page content as Markdown. */
  content: string;
}

export interface ApiErrorBody {
  error: {
    message: string;
    type?: string;
    param?: null;
    code?: string;
  };
}
