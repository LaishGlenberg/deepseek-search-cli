import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_BASE_URL, loadConfig, parseEnvFile } from '../src/config.js';

const tempDirs: string[] = [];

function tempDirWithDotEnv(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsearch-config-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, '.env'), contents);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('parseEnvFile', () => {
  it('parses simple values, comments, export, and quotes', () => {
    expect(
      parseEnvFile(
        [
          '# comment',
          '',
          'DEEPSEEK_API_KEY=sk-plain',
          'export DEEPSEEK_BASE_URL="https://proxy.test"',
          "QUOTED='single value'",
          'NO_EQUALS',
          'EMPTY=',
        ].join('\n'),
      ),
    ).toEqual({
      DEEPSEEK_API_KEY: 'sk-plain',
      DEEPSEEK_BASE_URL: 'https://proxy.test',
      QUOTED: 'single value',
      EMPTY: '',
    });
  });
});

describe('loadConfig', () => {
  it('prefers environment variables over .env', () => {
    const cwd = tempDirWithDotEnv('DEEPSEEK_API_KEY=from-file\nDEEPSEEK_BASE_URL=https://file.test\n');
    const config = loadConfig(
      { DEEPSEEK_API_KEY: ' from-env ', DEEPSEEK_BASE_URL: 'https://env.test/' } as NodeJS.ProcessEnv,
      cwd,
    );

    expect(config).toEqual({ apiKey: 'from-env', baseUrl: 'https://env.test' });
  });

  it('falls back to .env in the working directory', () => {
    const cwd = tempDirWithDotEnv('DEEPSEEK_API_KEY=from-file\nDEEPSEEK_BASE_URL=https://file.test\n');

    expect(loadConfig({} as NodeJS.ProcessEnv, cwd)).toEqual({
      apiKey: 'from-file',
      baseUrl: 'https://file.test',
    });
  });

  it('uses the default base URL', () => {
    const cwd = tempDirWithDotEnv('DEEPSEEK_API_KEY=key\n');

    expect(loadConfig({} as NodeJS.ProcessEnv, cwd)).toEqual({
      apiKey: 'key',
      baseUrl: DEFAULT_BASE_URL,
    });
  });

  it('throws a helpful error when the key is missing', () => {
    const cwd = tempDirWithDotEnv('# nothing here\n');

    expect(() => loadConfig({} as NodeJS.ProcessEnv, cwd)).toThrow(ConfigError);
    expect(() => loadConfig({} as NodeJS.ProcessEnv, cwd)).toThrow(/DEEPSEEK_API_KEY is not set/);
  });
});
