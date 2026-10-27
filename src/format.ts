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
    return `No results found for \`${query}\`.`;
  }

  const header = `${results.length} result${results.length === 1 ? '' : 's'} for \`${query}\``;
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

/** Render a fetched page, showing its source URL. */
export function formatPage(url: string, page: FetchResponse): string {
  const title = page.title.trim();
  const content = page.content.trim();
  const head = title ? `${title}\n\`${url}\`` : `\`${url}\``;
  return content ? `${head}\n\n${content}` : head;
}

function escapeInline(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1');
}

function markdownMetadata(result: SearchResult): string | undefined {
  const parts: string[] = [];
  if (result.site_name) parts.push(result.site_name);
  if (result.date) parts.push(result.date.slice(0, 10));
  if (Number.isFinite(result.rerank_score)) parts.push(`Score ${result.rerank_score.toFixed(1)}`);
  if (Number.isFinite(result.authority) && result.authority >= 0) {
    parts.push(`Authority ${result.authority}`);
  }
  return parts.length > 0 ? `- ${parts.join(' · ')}` : undefined;
}

/** Render search results as a Markdown document. */
export function formatSearchMarkdown(
  query: string,
  results: SearchResult[],
  options: FormatSearchOptions = {},
): string {
  const lines = [`# Search results for \`${query.trim()}\``, ''];

  if (results.length === 0) {
    lines.push('No results found.');
    return `${lines.join('\n')}\n`;
  }

  results.forEach((result, index) => {
    const title = escapeInline((result.title || '(untitled)').trim());
    lines.push(`## ${index + 1}. [${title}](<${result.url}>)`, '');

    const metadata = markdownMetadata(result);
    if (metadata) lines.push(metadata, '');

    const body = (result.summary || result.snippet).trim();
    if (body) lines.push(body, '');

    if (options.content && result.content.trim()) {
      lines.push('### Content', '', result.content.trim(), '');
    }
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;

/**
 * Remove CommonMark backslash escapes before ASCII punctuation, leaving fenced
 * code blocks untouched. DeepSeek's fetch endpoint escapes every punctuation
 * character in `content`, which breaks headings and tables and makes `\(`/`\[`
 * look like LaTeX math delimiters to KaTeX-based renderers.
 */
export function unescapeMarkdown(text: string): string {
  let fence: string | undefined;

  return text
    .split(/\r?\n/)
    .map((line) => {
      const opening = line.match(FENCE)?.[1];

      if (fence) {
        if (opening && opening[0] === fence[0] && opening.length >= fence.length) fence = undefined;
        return line;
      }

      if (opening) {
        fence = opening;
        return line;
      }

      return line.replace(ESCAPED_PUNCTUATION, '$1');
    })
    .join('\n');
}

/** Render a fetched page as a Markdown document, showing its source URL. */
export function formatPageMarkdown(url: string, page: FetchResponse): string {
  const title = page.title.trim();
  const content = page.content.trim();
  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  parts.push(`\`${url}\``);
  if (content) parts.push(content);
  return `${parts.join('\n\n')}\n`;
}
