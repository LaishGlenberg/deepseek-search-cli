import { describe, expect, it } from 'vitest';
import {
  formatPage,
  formatPageMarkdown,
  formatSearchMarkdown,
  formatSearchResults,
  unescapeMarkdown,
} from '../src/format.js';
import type { SearchResult } from '../src/types.js';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    rerank_score: 2.45,
    title: 'DeepSeek V4 released',
    url: 'https://example.com/deepseek-v4',
    snippet: 'Short snippet.',
    summary: 'Long summary line one.\nLine two.',
    content: 'Full page content.',
    site_name: 'Example News',
    site_icon: null,
    date: '2026-06-01T00:00:00+00:00',
    authority: 3,
    ...overrides,
  };
}

describe('formatSearchResults', () => {
  it('handles no results', () => {
    expect(formatSearchResults('nothing', [])).toBe('No results found for `nothing`.');
  });

  it('formats rank, title, URL, metadata, and summary', () => {
    const output = formatSearchResults('deepseek', [result()]);

    expect(output).toContain('1 result for `deepseek`');
    expect(output).toContain('1. DeepSeek V4 released [2.5]');
    expect(output).toContain('https://example.com/deepseek-v4');
    expect(output).toContain('Example News · 2026-06-01 · authority 3');
    expect(output).toContain('   Long summary line one.\n   Line two.');
    expect(output).not.toContain('Full page content.');
  });

  it('falls back to the snippet and pluralizes results', () => {
    const output = formatSearchResults('q', [
      result({ summary: '', date: null, site_name: null, authority: -1 }),
      result({ summary: '', title: 'Second', date: null, site_name: null, authority: -1 }),
    ]);

    expect(output).toContain('2 results for `q`');
    expect(output).toContain('Short snippet.');
    expect(output).not.toContain('authority');
  });

  it('includes page content when requested', () => {
    const output = formatSearchResults('q', [result()], { content: true });

    expect(output).toContain('   content:');
    expect(output).toContain('   Full page content.');
  });

  it('survives missing titles and scores', () => {
    const output = formatSearchResults('q', [
      result({ title: '', rerank_score: Number.NaN, snippet: '', summary: '' }),
    ]);

    expect(output).toContain('(untitled)');
  });
});

describe('formatPage', () => {
  it('shows the source URL and Markdown content', () => {
    expect(formatPage('https://example.com/a', { title: 'Page', content: '# Heading' })).toBe(
      'Page\n`https://example.com/a`\n\n# Heading',
    );
  });

  it('omits empty parts', () => {
    expect(formatPage('https://example.com', { title: '', content: 'Body' })).toBe(
      '`https://example.com`\n\nBody',
    );
    expect(formatPage('https://example.com', { title: 'Title', content: '' })).toBe(
      'Title\n`https://example.com`',
    );
  });
});

describe('formatSearchMarkdown', () => {
  it('renders linked titles, metadata, and summaries', () => {
    const markdown = formatSearchMarkdown('deepseek v4', [result()]);

    expect(markdown).toContain('# Search results for `deepseek v4`');
    expect(markdown).toContain('## 1. [DeepSeek V4 released](<https://example.com/deepseek-v4>)');
    expect(markdown).toContain('- Example News · 2026-06-01 · Score 2.5 · Authority 3');
    expect(markdown).toContain('Long summary line one.\nLine two.');
    expect(markdown).not.toContain('Full page content.');
    expect(markdown.endsWith('\n')).toBe(true);
  });

  it('includes page content when requested', () => {
    const markdown = formatSearchMarkdown('q', [result()], { content: true });

    expect(markdown).toContain('### Content\n\nFull page content.');
  });

  it('handles no results', () => {
    expect(formatSearchMarkdown('nothing', [])).toBe('# Search results for `nothing`\n\nNo results found.\n');
  });

  it('escapes link text and skips missing metadata', () => {
    const markdown = formatSearchMarkdown('q', [
      result({
        title: 'A [b] c',
        rerank_score: Number.NaN,
        date: null,
        site_name: null,
        authority: -1,
        summary: '',
        snippet: '',
      }),
    ]);

    expect(markdown).toContain('## 1. [A \\[b\\] c](<https://example.com/deepseek-v4>)');
    expect(markdown).not.toContain('Score');
    expect(markdown).not.toContain('·');
  });

  it('falls back to the snippet when there is no summary', () => {
    expect(formatSearchMarkdown('q', [result({ summary: '' })])).toContain('Short snippet.');
  });
});

describe('formatPageMarkdown', () => {
  it('renders a title heading, the source URL, and the page content', () => {
    expect(formatPageMarkdown('https://example.com/a', { title: 'Page', content: '# Heading' })).toBe(
      '# Page\n\n`https://example.com/a`\n\n# Heading\n',
    );
  });

  it('omits empty parts', () => {
    expect(formatPageMarkdown('https://example.com', { title: '', content: 'Body' })).toBe(
      '`https://example.com`\n\nBody\n',
    );
    expect(formatPageMarkdown('https://example.com', { title: 'Title', content: '' })).toBe(
      '# Title\n\n`https://example.com`\n',
    );
  });
});

describe('unescapeMarkdown', () => {
  it('unescapes headings, tables, links, and math-like delimiters', () => {
    const escaped = [
      '\\# Models \\& Pricing',
      'Search \\/ Fetch API \\[here\\]\\(https\\:\\/\\/example\\.com\\)',
      '\\-\\-\\-\\|\\-\\-\\-',
    ].join('\n');

    expect(unescapeMarkdown(escaped)).toBe(
      ['# Models & Pricing', 'Search / Fetch API [here](https://example.com)', '---|---'].join('\n'),
    );
  });

  it('leaves fenced code blocks untouched', () => {
    const text = ['\\# heading', '```js', 'const re = /a\\.b\\(c\\)/;', '```', '\\# next'].join('\n');

    expect(unescapeMarkdown(text)).toBe(
      ['# heading', '```js', 'const re = /a\\.b\\(c\\)/;', '```', '# next'].join('\n'),
    );
  });

  it('supports tilde fences', () => {
    const text = ['~~~', '\\.keep', '~~~', '\\.strip'].join('\n');
    expect(unescapeMarkdown(text)).toBe(['~~~', '\\.keep', '~~~', '.strip'].join('\n'));
  });
});
