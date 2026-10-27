import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_BASE_URL,
  configPath,
  loadConfig,
  parseEnvFile,
  saveApiKey,
} from '../src/config.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsearch-config-'));
  tempDirs.push(dir);
  return dir;
}

/** Keep the user config file out of the developer's real home directory. */
function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: join(tempDir(), 'xdg'), APPDATA: join(tempDir(), 'appdata'), ...extra };
}

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
      isolatedEnv({ DEEPSEEK_API_KEY: ' from-env ', DEEPSEEK_BASE_URL: 'https://env.test/' }),
      cwd,
    );

    expect(config).toEqual({ apiKey: 'from-env', baseUrl: 'https://env.test' });
  });

  it('falls back to .env in the working directory', () => {
    const cwd = tempDirWithDotEnv('DEEPSEEK_API_KEY=from-file\nDEEPSEEK_BASE_URL=https://file.test\n');

    expect(loadConfig(isolatedEnv(), cwd)).toEqual({
      apiKey: 'from-file',
      baseUrl: 'https://file.test',
    });
  });

  it('uses the default base URL', () => {
    const cwd = tempDirWithDotEnv('DEEPSEEK_API_KEY=key\n');

    expect(loadConfig(isolatedEnv(), cwd)).toEqual({
      apiKey: 'key',
      baseUrl: DEFAULT_BASE_URL,
    });
  });

  it('throws a helpful error when the key is missing', () => {
    const cwd = tempDirWithDotEnv('# nothing here\n');

    expect(() => loadConfig(isolatedEnv(), cwd)).toThrow(ConfigError);
    expect(() => loadConfig(isolatedEnv(), cwd)).toThrow(/DEEPSEEK_API_KEY is not set/);
  });
});

describe('user config file', () => {
  it('saves the key to the config path and loads it as a fallback', () => {
    const dir = tempDir();
    const env = isolatedEnv();

    const target = saveApiKey('sk-saved', env);

    expect(target).toBe(configPath(env));
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ apiKey: 'sk-saved' });
    expect(loadConfig(env, dir)).toEqual({ apiKey: 'sk-saved', baseUrl: DEFAULT_BASE_URL });
  });

  it('prefers the environment and .env over the saved key', () => {
    const env = isolatedEnv();
    saveApiKey('sk-saved', env);

    expect(loadConfig({ ...env, DEEPSEEK_API_KEY: 'sk-env' }, tempDir()).apiKey).toBe('sk-env');
    expect(loadConfig(env, tempDirWithDotEnv('DEEPSEEK_API_KEY=sk-dotenv')).apiKey).toBe('sk-dotenv');
  });

  it('ignores a malformed config file', () => {
    const env = isolatedEnv();
    const target = configPath(env);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'not json');

    expect(() => loadConfig(env, tempDir())).toThrow(/DEEPSEEK_API_KEY is not set/);
  });

  it.skipIf(process.platform === 'win32')('creates the file with mode 0600', () => {
    const env = isolatedEnv();
    const target = saveApiKey('sk-created', env);

    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('tightens an existing loose file to 0600', () => {
    const env = isolatedEnv();
    const target = configPath(env);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{"apiKey":"sk-old"}\n', { mode: 0o644 });
    expect(statSync(target).mode & 0o777).toBe(0o644);

    saveApiKey('sk-new', env);

    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ apiKey: 'sk-new' });
  });
});
