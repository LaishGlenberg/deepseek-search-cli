import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Config {
  apiKey: string;
  baseUrl: string;
}

/** Parse simple `KEY=value` lines, ignoring comments, blank lines, and `export `. */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    if (key) values[key] = value;
  }

  return values;
}

function readDotEnv(cwd: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(join(cwd, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

/** Directory for user-level dsearch files (`config.json`, `usage.jsonl`). */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') {
    const base = env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    return join(base, 'dsearch');
  }
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'dsearch');
}

/** Path of the user-level config file written by `dsearch auth`. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

function readStoredApiKey(env: NodeJS.ProcessEnv): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(env), 'utf8'));
    if (parsed && typeof parsed === 'object' && 'apiKey' in parsed) {
      const value = (parsed as { apiKey?: unknown }).apiKey;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    // Missing or malformed config file: fall through to the error below.
  }
  return undefined;
}

/** Save the API key to the user config file and return the path written. */
export function saveApiKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const target = configPath(env);
  mkdirSync(dirname(target), { recursive: true });

  // Write privately to a temp file, then rename, so the config is never left
  // half-written if the process dies mid-save.
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ apiKey }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }

  // `mode` only applies when the file is created, so tighten a file that already
  // existed with looser permissions. Windows ignores POSIX modes.
  if (process.platform !== 'win32') chmodSync(target, 0o600);

  return target;
}

/**
 * Resolve the API key from the environment, then `./.env`, then the user config file
 * written by `dsearch auth`. The base URL is environment-only: a `.env` can arrive with
 * a cloned repository, and every request sends the key to that origin. Throws
 * `ConfigError` when the API key is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  const fileValues = readDotEnv(cwd);
  const apiKey =
    env.DEEPSEEK_API_KEY?.trim() || fileValues.DEEPSEEK_API_KEY?.trim() || readStoredApiKey(env);
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new ConfigError(
      'DEEPSEEK_API_KEY is not set.\n' +
        'Run `dsearch auth` to save your key, or set it in your environment or a .env file:\n' +
        '  DEEPSEEK_API_KEY=sk-...\n' +
        'Create a key at https://platform.deepseek.com/api_keys',
    );
  }

  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, '') };
}
