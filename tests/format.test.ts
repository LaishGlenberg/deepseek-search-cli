import { describe, expect, it } from 'vitest';
import { formatPage, formatSearchResults } from '../src/format.js';
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
    expect(formatSearchResults('nothing', [])).toBe('No results found for "nothing".');
  });

  it('formats rank, title, URL, metadata, and summary', () => {
    const output = formatSearchResults('deepseek', [result()]);

    expect(output).toContain('1 result for "deepseek"');
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

    expect(output).toContain('2 results for "q"');
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
  it('prints the title and Markdown content', () => {
    expect(formatPage({ title: 'Page', content: '# Heading' })).toBe('Page\n\n# Heading');
  });

  it('omits empty parts', () => {
    expect(formatPage({ title: '', content: 'Body' })).toBe('Body');
    expect(formatPage({ title: 'Title', content: '' })).toBe('Title');
  });
});
