import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

function envFor(serverUrl: string, apiKey = 'integration-key'): NodeJS.ProcessEnv {
  return { ...process.env, DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: serverUrl };
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

  it('writes search results and fetched pages to Markdown files', async () => {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
    const env = { ...process.env };
    delete env.DEEPSEEK_API_KEY;
    delete env.DEEPSEEK_BASE_URL;
    const dir = mkdtempSync(join(tmpdir(), 'dsearch-cli-'));

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
