import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

/**
 * End-to-end test against the package exactly as users receive it: it downloads the
 * published tarball from the npm registry into a temporary prefix, runs a real Search
 * request, then uninstalls. It therefore exercises the *published* version, not this
 * checkout, needs network access, and bills one request (~$0.00075) per test.
 *
 *   npm run test:e2e                      # runs with --mode e2e
 *   RUN_E2E_TESTS=1 npm test              # opt the full suite in
 */
const mode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
const e2e = mode === 'e2e' || process.env.RUN_E2E_TESTS === '1' ? describe : describe.skip;

const PACKAGE = 'deepseek-search-cli';
const BIN = process.platform === 'win32' ? 'dsearch.cmd' : 'dsearch';
const TIMEOUT = 180_000;
const REAL_BASE_URL = 'https://api.deepseek.com';

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command without throwing, so a failure can be inspected instead of aborting
 * the test at the first bad exit code. `npm` is invoked through the same Node binary
 * when npm's own entry point is known, which avoids `.cmd` shell shims on Windows.
 */
const npmPrefix: [string, string[]] = process.env.npm_execpath
  ? [process.execPath, [process.env.npm_execpath]]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];

function runCommand(
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env: options.env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = (error as { code?: unknown } | null)?.code;
        resolve({ code: error ? (typeof exitCode === 'number' ? exitCode : 1) : 0, stdout, stderr });
      },
    );
  });
}

function runNpm(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<ExecResult> {
  return runCommand(npmPrefix[0], [...npmPrefix[1], ...args], options);
}

/**
 * Windows refuses to spawn a `.cmd` shim without a shell, so there the bin target is
 * run through Node directly. The shim's presence is asserted separately, which is what
 * validates the `bin` wiring for `dsearch`.
 */
function cliInvocation(binPath: string, packageDir: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.execPath, args: [join(packageDir, 'dist', 'index.js'), ...args] };
  }
  return { file: binPath, args };
}

/** Isolate the npm cache per test so the download is real, not a warm-cache replay. */
function sandbox(): { dir: string; cwd: string; cache: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsearch-e2e-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsearch-e2e-cache-'));

  return {
    dir,
    cwd: dir,
    cache,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: apiKey(),
      DEEPSEEK_BASE_URL: REAL_BASE_URL,
      npm_config_cache: cache,
      npm_config_loglevel: 'silent',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}

let cachedApiKey: string | undefined;

/** The e2e test makes a real, billed request, so it needs a real key. */
function apiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  try {
    cachedApiKey = loadConfig().apiKey;
    return cachedApiKey;
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : String(error);
    throw new Error(
      `This test makes a real billed request and needs an API key.\n${detail}`,
      { cause: error },
    );
  }
}

interface SearchPayload {
  results?: Array<{ url?: unknown; title?: unknown }>;
}

e2e('published npm package', () => {
  it(
    'installs from the registry, searches, and uninstalls',
    async () => {
      const box = sandbox();
      const binPath = join(box.dir, 'node_modules', '.bin', BIN);
      const packageDir = join(box.dir, 'node_modules', PACKAGE);

      try {
        // The version on the registry is the version we expect to install and run.
        const published = await runNpm(['view', PACKAGE, 'version'], box);
        expect(published.code, published.stderr).toBe(0);
        const publishedVersion = published.stdout.trim();
        expect(publishedVersion).toMatch(/^\d+\.\d+\.\d+/);

        const install = await runNpm(['install', '--no-save', PACKAGE], box);
        expect(install.stderr).not.toContain('npm ERR!');
        expect(install.code, install.stderr).toBe(0);
        expect(existsSync(binPath)).toBe(true);
        expect(existsSync(join(packageDir, 'dist', 'index.js'))).toBe(true);

        const versionInvocation = cliInvocation(binPath, packageDir, ['--version']);
        const version = await runCommand(versionInvocation.file, versionInvocation.args, box);
        expect(version.code, version.stderr).toBe(0);
        expect(version.stderr).toBe('');
        expect(version.stdout.trim()).toBe(publishedVersion);

        const searchArgs = ['search', 'DeepSeek API documentation', '-n', '1', '--json'];
        const searchInvocation = cliInvocation(binPath, packageDir, searchArgs);
        const search = await runCommand(searchInvocation.file, searchInvocation.args, box);
        expect(search.code, search.stderr).toBe(0);
        expect(search.stderr).toBe('');

        const payload = JSON.parse(search.stdout) as SearchPayload;
        const results = payload.results ?? [];
        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
          expect(String(result.url)).toMatch(/^https?:\/\//);
          expect(typeof result.title).toBe('string');
        }

        const uninstall = await runNpm(['uninstall', PACKAGE], box);
        expect(uninstall.stderr).not.toContain('npm ERR!');
        expect(uninstall.code, uninstall.stderr).toBe(0);
        expect(existsSync(binPath)).toBe(false);
        expect(existsSync(packageDir)).toBe(false);
      } finally {
        box.cleanup();
      }
    },
    TIMEOUT,
  );

  it(
    'runs through npx without a prior install',
    async () => {
      const box = sandbox();

      try {
        // Nothing is installed here: npx has to download the package itself.
        expect(existsSync(join(box.dir, 'node_modules'))).toBe(false);

        const search = await runNpm(
          [
            'exec',
            '--yes',
            `--package=${PACKAGE}`,
            '--',
            'dsearch',
            'search',
            'DeepSeek API documentation',
            '-n',
            '1',
            '--json',
          ],
          box,
        );
        expect(search.stderr).not.toContain('npm ERR!');
        expect(search.code, search.stderr).toBe(0);
        expect(search.stderr).toBe('');

        const payload = JSON.parse(search.stdout) as SearchPayload;
        expect(payload.results?.length ?? 0).toBeGreaterThan(0);
      } finally {
        box.cleanup();
      }
    },
    TIMEOUT,
  );
});
