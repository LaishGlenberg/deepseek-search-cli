import type { FetchResponse, SearchResult } from './types.js';

function indentBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line ? `   ${line}` : ''))
    .join('\n');
}

function formatMetadata(result: SearchResult): string | undefined {
  const parts: string[] = [];
  if (result.site_name) parts.push(result.site_name);
  if (result.date) parts.push(result.date.slice(0, 10));
  if (Number.isFinite(result.authority) && result.authority >= 0) {
    parts.push(`authority ${result.authority}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export interface FormatSearchOptions {
  /** Include full page content below each result. */
  content?: boolean;
}

/** Render search results for a terminal. */
export function formatSearchResults(
  query: string,
  results: SearchResult[],
  options: FormatSearchOptions = {},
): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const header = `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`;
  const blocks: string[] = [];

  results.forEach((result, index) => {
    const score = Number.isFinite(result.rerank_score) ? ` [${result.rerank_score.toFixed(1)}]` : '';
    const lines = [`${index + 1}. ${result.title || '(untitled)'}${score}`, `   ${result.url}`];

    const metadata = formatMetadata(result);
    if (metadata) lines.push(`   ${metadata}`);

    const body = (result.summary || result.snippet).trim();
    if (body) lines.push('', indentBlock(body));

    if (options.content && result.content) {
      lines.push('', '   content:', indentBlock(result.content.trim()));
    }

    blocks.push(lines.join('\n'));
  });

  return [header, '', blocks.join('\n\n')].join('\n');
}

/** Render a fetched page. */
export function formatPage(page: FetchResponse): string {
  const title = page.title.trim();
  const content = page.content.trim();
  if (!title) return content;
  if (!content) return title;
  return `${title}\n\n${content}`;
}
