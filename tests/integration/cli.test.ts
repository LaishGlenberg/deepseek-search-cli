import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { startMockServer } from './mock-server.js';

const CLI_PATH = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Keep usage recording out of the developer's real config directory. */
const usageDir = mkdtempSync(join(tmpdir(), 'dsearch-integration-usage-'));
afterAll(() => rmSync(usageDir, { recursive: true, force: true }));
const CONFIG_ENV: NodeJS.ProcessEnv =
  process.platform === 'win32' ? { APPDATA: usageDir } : { XDG_CONFIG_HOME: usageDir };

function envFor(serverUrl: string, apiKey = 'integration-key'): NodeJS.ProcessEnv {
  return { ...process.env, ...CONFIG_ENV, DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: serverUrl };
}

describe('built CLI against a local HTTP server', () => {
  it('runs a human-readable search', async () => {
    const server = await startMockServer();

    try {
      const { code, stdout, stderr } = await runCli(
        ['search', 'deepseek v4', '-n', '2', '--content'],
        { env: envFor(server.url) },
      );

      expect(code).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('1 result for `deepseek v4`');
      expect(stdout).toContain('Result for deepseek v4');
      expect(stdout).toContain('Full content from the mock server.');
      expect(server.requests[0]).toMatchObject({
        path: '/v1/tools/search',
        headers: { authorization: 'Bearer integration-key' },
        body: { query: 'deepseek v4', count: 2, need_content: true },
      });
    } finally {
      await server.close();
    }
  });

  it('runs a JSON search', async () => {
    const server = await startMockServer();

    try {
      const { code, stdout } = await runCli(['search', 'json query', '--json'], {
        env: envFor(server.url),
      });

      expect(code).toBe(0);
      const payload = JSON.parse(stdout) as { results: { title: string }[] };
      expect(payload.results[0]?.title).toBe('Result for json query');
    } finally {
      await server.close();
    }
  });

  it('records billable requests and reports them with dsearch cost', async () => {
    const server = await startMockServer();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-integration-cost-'));
    const configEnv: NodeJS.ProcessEnv =
      process.platform === 'win32' ? { APPDATA: dir } : { XDG_CONFIG_HOME: dir };
    const isolatedEnv = {
      ...process.env,
      ...configEnv,
      DEEPSEEK_API_KEY: 'integration-key',
      DEEPSEEK_BASE_URL: server.url,
    };

    try {
      expect((await runCli(['search', 'q'], { env: isolatedEnv, cwd: dir })).code).toBe(0);
      expect((await runCli(['search', 'q', '--count=0'], { env: isolatedEnv, cwd: dir })).code).toBe(2);

      const cost = await runCli(['cost', '--json'], { env: isolatedEnv, cwd: dir });
      expect(cost.code).toBe(0);
      const payload = JSON.parse(cost.stdout) as {
        windows: { id: string; searches: number; fetches: number; requests: number }[];
        usageFile: string;
      };
      expect(payload.windows.find((window) => window.id === 'allTime')).toMatchObject({
        searches: 1,
        fetches: 0,
        requests: 1,
      });
      expect(payload.usageFile).toBe(join(dir, 'dsearch', 'usage.jsonl'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await server.close();
    }
  });

  it('runs a fetch', async () => {
    const server = await startMockServer();

    try {
      const { code, stdout } = await runCli(['fetch', 'https://example.com/article'], {
        env: envFor(server.url),
      });

      expect(code).toBe(0);
      expect(stdout).toBe('Mock page\n`https://example.com/article`\n\n# Mock page\n\nFetched content.\n');
      expect(server.requests[0]).toMatchObject({
        path: '/v1/tools/fetch',
        body: { url: 'https://example.com/article' },
      });
    } finally {
      await server.close();
    }
  });

  it('writes search results and fetched pages to files', async () => {
    const server = await startMockServer();
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-md-'));

    try {
      const search = await runCli(
        ['search', 'deepseek v4', '--content', '-o', join(dir, 'search.md')],
        { env: envFor(server.url) },
      );

      expect(search.code).toBe(0);
      expect(search.stdout).toContain('Wrote 1 result to');
      const searchMarkdown = readFileSync(join(dir, 'search.md'), 'utf8');
      expect(searchMarkdown).toContain('# Search results for `deepseek v4`');
      expect(searchMarkdown).toContain('Result for deepseek v4');
      expect(searchMarkdown).toContain('Full content from the mock server.');

      const fetched = await runCli(
        ['fetch', 'https://example.com/article', '--output', 'pages/page.md'],
        { env: envFor(server.url), cwd: dir },
      );

      expect(fetched.code).toBe(0);
      expect(fetched.stdout).toContain('Wrote page to pages/page.md');
      expect(readFileSync(join(dir, 'pages', 'page.md'), 'utf8')).toBe(
        '# Mock page\n\n`https://example.com/article`\n\n# Mock page\n\nFetched content.\n',
      );

      const jsonSearch = await runCli(
        ['search', 'deepseek v4', '-j', '-o', join(dir, 'search.json')],
        { env: envFor(server.url) },
      );

      expect(jsonSearch.code).toBe(0);
      expect(jsonSearch.stdout).toContain(`Wrote JSON to ${join(dir, 'search.json')}`);
      const searchJson = JSON.parse(readFileSync(join(dir, 'search.json'), 'utf8')) as {
        results: { title: string }[];
      };
      expect(searchJson.results[0]?.title).toBe('Result for deepseek v4');

      const jsonFetch = await runCli(
        ['fetch', 'https://example.com/article', '--json', '-o', 'pages/page.json'],
        { env: envFor(server.url), cwd: dir },
      );

      expect(jsonFetch.code).toBe(0);
      expect(jsonFetch.stdout).toContain('Wrote JSON to pages/page.json');
      const pageJson = JSON.parse(readFileSync(join(dir, 'pages', 'page.json'), 'utf8')) as {
        title: string;
      };
      expect(pageJson.title).toBe('Mock page');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await server.close();
    }
  });

  it('fetches a bare URL without the fetch command', async () => {
    const server = await startMockServer();

    try {
      const { code, stdout } = await runCli(['https://example.com/article'], {
        env: envFor(server.url),
      });

      expect(code).toBe(0);
      expect(stdout).toBe('Mock page\n`https://example.com/article`\n\n# Mock page\n\nFetched content.\n');
      expect(server.requests[0]).toMatchObject({
        path: '/v1/tools/fetch',
        body: { url: 'https://example.com/article' },
      });
    } finally {
      await server.close();
    }
  });

  it('exits 1 on an API error', async () => {
    const server = await startMockServer(() => ({
      status: 401,
      body: { error: { message: 'Authentication Fails', code: 'invalid_request_error' } },
    }));

    try {
      const { code, stderr } = await runCli(['search', 'q'], { env: envFor(server.url) });

      expect(code).toBe(1);
      expect(stderr).toContain('DeepSeek API error (401): Authentication Fails');
      expect(stderr).toContain('Check that DEEPSEEK_API_KEY is valid.');
    } finally {
      await server.close();
    }
  });

  it('exits 2 without a key and 2 on usage errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-cli-'));
    // Isolate the config file that `dsearch auth` writes (APPDATA on Windows,
    // XDG_CONFIG_HOME elsewhere), so a developer's saved key cannot leak in.
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: dir, XDG_CONFIG_HOME: dir };
    delete env.DEEPSEEK_API_KEY;
    delete env.DEEPSEEK_BASE_URL;

    try {
      const noKey = await runCli(['search', 'q'], { env, cwd: dir });
      expect(noKey.code).toBe(2);
      expect(noKey.stderr).toContain('DEEPSEEK_API_KEY is not set');

      const usage = await runCli(['search', 'q', '--count=0'], { env, cwd: dir });
      expect(usage.code).toBe(2);
      expect(usage.stderr).toContain('--count must be an integer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when the server is unreachable', async () => {
    // Reserve a port, then close it so the CLI gets a connection failure.
    const server = await startMockServer();
    const url = server.url;
    await server.close();

    const { code, stderr } = await runCli(['search', 'q'], { env: envFor(url) });

    expect(code).toBe(1);
    expect(stderr).toContain('Could not reach the DeepSeek API');
  });
});
