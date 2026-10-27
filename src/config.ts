import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Resolve configuration from the process environment, falling back to `./.env`.
 * Throws `ConfigError` with setup instructions when the API key is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  const fileValues = readDotEnv(cwd);
  const apiKey = env.DEEPSEEK_API_KEY?.trim() || fileValues.DEEPSEEK_API_KEY?.trim();
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || fileValues.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new ConfigError(
      'DEEPSEEK_API_KEY is not set.\n' +
        'Set it in your environment or add it to a .env file:\n' +
        '  DEEPSEEK_API_KEY=sk-...\n' +
        'Create a key at https://platform.deepseek.com/api_keys',
    );
  }

  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, '') };
}
