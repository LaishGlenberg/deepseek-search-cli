import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/config.js';
import { createDsearch } from '../src/sdk.js';
import { readUsage } from '../src/usage.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Keep the usage ledger and any saved key out of the developer's real home. */
function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: join(tempDir('dsearch-sdk-xdg-'), 'xdg'), APPDATA: join(tempDir('dsearch-sdk-app-'), 'appdata'), ...extra };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function result(url = 'https://example.com/result') {
  return {
    rerank_score: 2.4,
    title: 'Result',
    url,
    snippet: 'snippet',
    summary: 'summary',
    content: 'content',
    site_name: null,
    site_icon: null,
    date: null,
    authority: 3,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('createDsearch', () => {
  it('searches with an explicit key and records the billable request', async () => {
    const env = isolatedEnv();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [result()] }));
    const ds = createDsearch({ apiKey: 'secret', env, fetchImpl });

    const response = await ds.search('deepseek', { count: 3 });

    expect(response.results).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'deepseek', count: 3 });
    expect(readUsage(env)).toHaveLength(1);
    expect(readUsage(env)[0]?.kind).toBe('search');
  });

  it('fetches a page and records it', async () => {
    const env = isolatedEnv();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ title: 'Page', content: '# Page' }),
    );
    const ds = createDsearch({ apiKey: 'secret', env, fetchImpl });

    const page = await ds.fetchPage('https://example.com');

    expect(page).toEqual({ title: 'Page', content: '# Page' });
    expect(readUsage(env)[0]?.kind).toBe('fetch');
  });

  it('does not record a search with no results or a fetch with no content', async () => {
    const env = isolatedEnv();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [] }));
    const ds = createDsearch({ apiKey: 'secret', env, fetchImpl });

    await ds.search('empty');

    const emptyFetch = vi.fn<typeof fetch>(async () => jsonResponse({ title: 'Empty', content: '  ' }));
    await createDsearch({ apiKey: 'secret', env, fetchImpl: emptyFetch }).fetchPage('https://example.com');

    expect(readUsage(env)).toEqual([]);
  });

  it('skips usage tracking when trackUsage is false', async () => {
    const env = isolatedEnv();
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [result()] }));
    const ds = createDsearch({ apiKey: 'secret', env, fetchImpl, trackUsage: false });

    await ds.search('q');

    expect(readUsage(env)).toEqual([]);
  });

  it('resolves the key lazily so construction never throws', async () => {
    const env = isolatedEnv();
    // An empty cwd keeps a developer's real .env out of the lookup.
    const ds = createDsearch({ env, cwd: tempDir('dsearch-sdk-cwd-'), fetchImpl: vi.fn<typeof fetch>() });

    expect(() => ds).not.toThrow();
    await expect(ds.search('q')).rejects.toBeInstanceOf(ConfigError);
  });

  it('honors DEEPSEEK_BASE_URL when no baseUrl is passed', async () => {
    const env = isolatedEnv({ DEEPSEEK_BASE_URL: 'http://127.0.0.1:9/mock/' });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [result()] }));

    await createDsearch({ apiKey: 'secret', env, fetchImpl }).search('q');

    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:9/mock/v1/tools/search');
  });
});
