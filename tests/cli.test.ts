import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, parseArgs, UsageError } from '../src/cli.js';
import type { SearchResult } from '../src/types.js';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    rerank_score: 2.4,
    title: 'DeepSeek V4 released',
    url: 'https://example.com/deepseek-v4',
    snippet: 'Short snippet.',
    summary: 'A longer summary about the release.',
    content: 'Full page content.',
    site_name: 'Example News',
    site_icon: null,
    date: '2026-06-01T00:00:00+00:00',
    authority: 3,
    ...overrides,
  };
}

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    deps: {
      out: (message: string) => stdout.push(message),
      err: (message: string) => stderr.push(message),
    },
  };
}

const searchResponse = async () => fakeResponse({ results: [result()] });
const emptyResponse = async () => fakeResponse({ results: [] });
const pageResponse = async () => fakeResponse({ title: 'Example', content: '# Body' });
const authErrorResponse = async () =>
  fakeResponse({ error: { message: 'Authentication Fails', code: 'invalid_request_error' } }, 401);
const connectionFailure = async (): Promise<Response> => {
  throw new Error('connection refused');
};

describe('parseArgs', () => {
  it('shows help with no arguments or help commands', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('shows the version', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
    expect(parseArgs(['version'])).toEqual({ kind: 'version' });
  });

  it('joins positional search words into a query', () => {
    expect(parseArgs(['search', 'deepseek', 'v4', 'release'])).toMatchObject({
      kind: 'search',
      query: 'deepseek v4 release',
    });
  });

  it('treats a bare query as a search', () => {
    expect(parseArgs(['deepseek v4'])).toMatchObject({
      kind: 'search',
      query: 'deepseek v4',
    });
    expect(parseArgs(['deep release', '-n', '5'])).toMatchObject({
      kind: 'search',
      query: 'deep release',
      count: 5,
    });
  });

  it('accepts search options before the query in shorthand mode', () => {
    expect(parseArgs(['-n', '5', 'deep release'])).toMatchObject({
      kind: 'search',
      query: 'deep release',
      count: 5,
    });
    expect(parseArgs(['--count=3', '--content', 'deep release'])).toMatchObject({
      kind: 'search',
      query: 'deep release',
      count: 3,
      needContent: true,
    });
    expect(parseArgs(['--json', 'deep release'])).toMatchObject({ kind: 'search', json: true });
    expect(parseArgs(['--', '--json'])).toMatchObject({ kind: 'search', query: '--json' });
    expect(() => parseArgs(['--bogus', 'q'])).toThrow(UsageError);
  });

  it('parses search options in both flag forms', () => {
    expect(parseArgs(['search', 'q', '-n', '5', '--content', '--json'])).toMatchObject({
      count: 5,
      needContent: true,
      json: true,
    });
    expect(parseArgs(['search', 'q', '--count=7'])).toMatchObject({ count: 7 });
    expect(parseArgs(['search', 'q', '--ori-question=what is new', '--localization=1.2.3.4'])).toMatchObject({
      oriQuestion: 'what is new',
      localization: '1.2.3.4',
    });
  });

  it('treats everything after -- as query text', () => {
    expect(parseArgs(['search', '--', '--json', '-n'])).toMatchObject({
      kind: 'search',
      query: '--json -n',
      json: false,
    });
  });

  it('rejects invalid counts', () => {
    for (const count of ['0', '51', 'abc', '2.5', '']) {
      expect(() => parseArgs(['search', 'q', `--count=${count}`])).toThrow(UsageError);
    }
    expect(() => parseArgs(['search', 'q', '--count'])).toThrow(UsageError);
  });

  it('rejects missing and oversized queries', () => {
    expect(() => parseArgs(['search'])).toThrow(UsageError);
    expect(() => parseArgs(['search', '   '])).toThrow(UsageError);
    expect(() => parseArgs(['search', 'x'.repeat(129)])).toThrow(UsageError);
    expect(parseArgs(['search', 'x'.repeat(128)])).toMatchObject({ kind: 'search' });
  });

  it('parses output options for search and fetch', () => {
    expect(parseArgs(['search', 'q', '-o', 'out.md'])).toMatchObject({ output: 'out.md' });
    expect(parseArgs(['deep release', '--output=notes/out.md'])).toMatchObject({
      kind: 'search',
      output: 'notes/out.md',
    });
    expect(parseArgs(['fetch', 'https://example.com', '-o', 'page.md'])).toMatchObject({
      kind: 'fetch',
      output: 'page.md',
    });
  });

  it('rejects invalid output options', () => {
    expect(() => parseArgs(['search', 'q', '-o'])).toThrow(UsageError);
    expect(() => parseArgs(['search', 'q', '--output='])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'https://example.com', '--output'])).toThrow(UsageError);
    expect(() => parseArgs(['search', 'q', '-o', 'x.md', '--json'])).toThrow(/--json/);
    expect(() => parseArgs(['fetch', 'https://example.com', '-o', 'x.md', '--json'])).toThrow(/--json/);
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['search', 'q', '--bogus'])).toThrow(UsageError);
  });

  it('parses fetch commands and validates URLs', () => {
    expect(parseArgs(['fetch', 'https://example.com/a'])).toEqual({
      kind: 'fetch',
      url: 'https://example.com/a',
      json: false,
    });
    expect(parseArgs(['fetch', 'https://example.com', '--json'])).toMatchObject({ json: true });

    expect(() => parseArgs(['fetch'])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'not a url'])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'ftp://example.com'])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'https://user:pass@example.com'])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'https://a.com', 'https://b.com'])).toThrow(UsageError);
    expect(() => parseArgs(['fetch', 'https://a.com', '--bogus'])).toThrow(UsageError);
  });
});

describe('main', () => {
  const env = { DEEPSEEK_API_KEY: 'test-key' } as NodeJS.ProcessEnv;

  it('prints help and version without needing a key', async () => {
    const help = capture();
    expect(await main(['--help'], { ...help.deps, env: {} })).toBe(0);
    expect(help.stdout.join('\n')).toContain('Usage:');

    const version = capture();
    expect(await main(['--version'], { ...version.deps, env: {} })).toBe(0);
    expect(version.stdout.join('\n')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints results for a search', async () => {
    const { stdout, stderr, deps } = capture();

    const code = await main(['search', 'deepseek v4', '-n', '1'], {
      ...deps,
      env,
      fetchImpl: searchResponse,
    });

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('\n');
    expect(output).toContain('1 result for "deepseek v4"');
    expect(output).toContain('DeepSeek V4 released');
    expect(output).toContain('https://example.com/deepseek-v4');
    expect(output).not.toContain('Full page content.');
  });

  it('prints raw JSON with --json and passes search options through', async () => {
    const { stdout, deps } = capture();
    let received: unknown;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      received = JSON.parse(String(init?.body));
      return fakeResponse({ results: [result()] });
    };

    const code = await main(
      ['search', 'q', '--count=3', '--content', '--ori-question=origin', '--json'],
      { ...deps, env, fetchImpl },
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ results: [{ title: 'DeepSeek V4 released' }] });
    expect(received).toEqual({
      query: 'q',
      count: 3,
      need_content: true,
      ori_question: 'origin',
    });
  });

  it('prints a fetched page', async () => {
    const { stdout, deps } = capture();

    expect(await main(['fetch', 'https://example.com'], { ...deps, env, fetchImpl: pageResponse })).toBe(0);
    expect(stdout.join('\n')).toBe('Example\n\n# Body');
  });

  it('returns 2 for usage errors', async () => {
    const { stderr, deps } = capture();
    expect(await main(['search', 'q', '--count=99'], { ...deps, env })).toBe(2);
    expect(stderr.join('\n')).toContain('--count must be an integer');
  });

  it('returns 2 when the API key is missing', async () => {
    const { stderr, deps } = capture();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-test-'));

    try {
      expect(await main(['search', 'q'], { ...deps, env: {}, cwd: dir })).toBe(2);
      expect(stderr.join('\n')).toContain('DEEPSEEK_API_KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 1 and a hint for API errors', async () => {
    const { stderr, deps } = capture();

    expect(await main(['search', 'q'], { ...deps, env, fetchImpl: authErrorResponse })).toBe(1);
    const output = stderr.join('\n');
    expect(output).toContain('DeepSeek API error (401)');
    expect(output).toContain('Check that DEEPSEEK_API_KEY is valid.');
  });

  it('returns 1 for network failures', async () => {
    const { stderr, deps } = capture();

    expect(await main(['search', 'q'], { ...deps, env, fetchImpl: connectionFailure })).toBe(1);
    expect(stderr.join('\n')).toContain('Could not reach the DeepSeek API');
  });

  it('writes search results to a Markdown file and creates parent directories', async () => {
    const { stdout, deps } = capture();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-out-'));

    try {
      const code = await main(['search', 'q', '-n', '1', '--content', '-o', 'notes/out.md'], {
        ...deps,
        env,
        cwd: dir,
        fetchImpl: searchResponse,
      });

      expect(code).toBe(0);
      expect(stdout.join('\n')).toBe('Wrote 1 result to notes/out.md');

      const markdown = readFileSync(join(dir, 'notes', 'out.md'), 'utf8');
      expect(markdown).toContain('# Search results for "q"');
      expect(markdown).toContain('[DeepSeek V4 released](<https://example.com/deepseek-v4>)');
      expect(markdown).toContain('A longer summary about the release.');
      expect(markdown).toContain('Full page content.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a fetched page to a Markdown file', async () => {
    const { stdout, deps } = capture();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-out-'));

    try {
      const code = await main(['fetch', 'https://example.com', '--output', 'page.md'], {
        ...deps,
        env,
        cwd: dir,
        fetchImpl: pageResponse,
      });

      expect(code).toBe(0);
      expect(stdout.join('\n')).toBe('Wrote page to page.md');
      expect(readFileSync(join(dir, 'page.md'), 'utf8')).toBe('# Example\n\n# Body\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 1 when the output file cannot be written', async () => {
    const { stderr, deps } = capture();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-out-'));

    try {
      // A directory cannot be overwritten as a file, regardless of platform.
      const code = await main(['search', 'q', '-o', '.'], {
        ...deps,
        env,
        cwd: dir,
        fetchImpl: searchResponse,
      });

      expect(code).toBe(1);
      expect(stderr.join('\n')).toContain('Error:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports empty result sets without failing', async () => {
    const { stdout, deps } = capture();

    expect(await main(['search', 'nothing'], { ...deps, env, fetchImpl: emptyResponse })).toBe(0);
    expect(stdout.join('\n')).toContain('No results found for "nothing".');
  });
});
