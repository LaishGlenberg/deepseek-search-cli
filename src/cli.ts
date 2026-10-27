import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createClient, DeepSeekApiError } from './client.js';
import { ConfigError, loadConfig } from './config.js';
import { formatPage, formatPageMarkdown, formatSearchMarkdown, formatSearchResults } from './format.js';
import { VERSION } from './version.js';

export const HELP = `dsearch — DeepSeek web search from the terminal

Usage:
  dsearch search <query...> [options]
  dsearch fetch <url> [options]
  dsearch "<query>" [options]
  dsearch <url> [options]

Commands:
  search <query...>   Search the web with DeepSeek
  fetch <url>         Fetch a single page as Markdown

Search options:
  -n, --count <1-50>       Number of results to return (default 10)
      --content            Include full page content in each result
      --ori-question <q>   Original user question, improves query understanding
      --localization <ip>  IP address used to localize results
      --json               Print the raw API response as JSON

Fetch options:
      --json               Print the raw API response as JSON

Global options:
  -o, --output <file>  Write Markdown to a file instead of stdout
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  DEEPSEEK_API_KEY    Required. Also read from ./.env
  DEEPSEEK_BASE_URL   Optional API base URL (default https://api.deepseek.com)

Examples:
  dsearch search "DeepSeek V4 release"
  dsearch "DeepSeek site:github.com after:2025" -n 5 --json
  dsearch "DeepSeek V4 release" -o results.md
  dsearch https://api-docs.deepseek.com/guides/search
  dsearch fetch https://api-docs.deepseek.com/guides/search --output docs/search.md`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface SearchCommand {
  kind: 'search';
  query: string;
  count?: number;
  needContent: boolean;
  oriQuestion?: string;
  localization?: string;
  json: boolean;
  output?: string;
}

export interface FetchCommand {
  kind: 'fetch';
  url: string;
  json: boolean;
  output?: string;
}

export type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | SearchCommand
  | FetchCommand;

interface OptionToken {
  name: string;
  inline?: string;
}

function splitOption(token: string): OptionToken {
  if (token.startsWith('--')) {
    const separator = token.indexOf('=');
    if (separator !== -1) {
      return { name: token.slice(0, separator), inline: token.slice(separator + 1) };
    }
  }
  return { name: token };
}

function takeValue(
  tokens: string[],
  index: number,
  option: OptionToken,
): { value: string; next: number } {
  if (option.inline !== undefined) {
    if (!option.inline) throw new UsageError(`Option ${option.name} requires a value.`);
    return { value: option.inline, next: index + 1 };
  }

  const value = tokens[index + 1];
  if (value === undefined) throw new UsageError(`Option ${option.name} requires a value.`);
  return { value, next: index + 2 };
}

function parseCount(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new UsageError(`--count must be an integer between 1 and 50 (got "${value}").`);
  }
  return count;
}

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new UsageError(`Option ${name} requires a non-empty value.`);
  return trimmed;
}

function parseSearch(tokens: string[]): ParsedCommand {
  let count: number | undefined;
  let needContent = false;
  let oriQuestion: string | undefined;
  let localization: string | undefined;
  let json = false;
  let output: string | undefined;
  let endOfOptions = false;
  const queryParts: string[] = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;

    if (!endOfOptions && token === '--') {
      endOfOptions = true;
      index += 1;
      continue;
    }

    if (!endOfOptions && token.startsWith('-') && token !== '-') {
      const option = splitOption(token);

      switch (option.name) {
        case '-h':
        case '--help':
          return { kind: 'help' };
        case '--json':
          json = true;
          index += 1;
          break;
        case '--content':
          needContent = true;
          index += 1;
          break;
        case '-n':
        case '--count': {
          const { value, next } = takeValue(tokens, index, option);
          count = parseCount(value);
          index = next;
          break;
        }
        case '--ori-question': {
          const { value, next } = takeValue(tokens, index, option);
          oriQuestion = requireValue(value, option.name);
          index = next;
          break;
        }
        case '--localization': {
          const { value, next } = takeValue(tokens, index, option);
          localization = requireValue(value, option.name);
          index = next;
          break;
        }
        case '-o':
        case '--output': {
          const { value, next } = takeValue(tokens, index, option);
          output = requireValue(value, option.name);
          index = next;
          break;
        }
        default:
          throw new UsageError(`Unknown option: ${token}`);
      }
      continue;
    }

    queryParts.push(token);
    index += 1;
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new UsageError('Missing search query. Usage: dsearch search <query...>');
  }

  const queryLength = [...query].length;
  if (queryLength > 128) {
    throw new UsageError(`Search query must be 128 characters or fewer (got ${queryLength}).`);
  }

  if (json && output) {
    throw new UsageError('--json cannot be combined with --output.');
  }

  return { kind: 'search', query, count, needContent, oriQuestion, localization, json, output };
}

function validateUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`Invalid URL: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError('URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new UsageError('URL must not include a username or password.');
  }
  if ([...value].length > 8192) {
    throw new UsageError('URL must be 8192 characters or fewer.');
  }
}

function parseFetch(tokens: string[]): ParsedCommand {
  let json = false;
  let output: string | undefined;
  let url: string | undefined;
  let endOfOptions = false;

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;

    if (!endOfOptions && token === '--') {
      endOfOptions = true;
      index += 1;
      continue;
    }

    if (!endOfOptions && (token === '-h' || token === '--help')) {
      return { kind: 'help' };
    }

    if (!endOfOptions && token === '--json') {
      json = true;
      index += 1;
      continue;
    }

    if (!endOfOptions && token.startsWith('-') && token !== '-') {
      const option = splitOption(token);

      if (option.name === '-o' || option.name === '--output') {
        const { value, next } = takeValue(tokens, index, option);
        output = requireValue(value, option.name);
        index = next;
        continue;
      }

      throw new UsageError(`Unknown option: ${token}`);
    }

    if (url !== undefined) {
      throw new UsageError('fetch accepts exactly one URL.');
    }

    url = token;
    index += 1;
  }

  if (!url) {
    throw new UsageError('Missing URL. Usage: dsearch fetch <url>');
  }

  if (json && output) {
    throw new UsageError('--json cannot be combined with --output.');
  }

  validateUrl(url);
  return { kind: 'fetch', url, json, output };
}

/** Search options that may appear before the query in shorthand mode. */
const SHORTHAND_OPTIONS = new Set([
  '-n',
  '--count',
  '--content',
  '--ori-question',
  '--localization',
  '--json',
  '--',
]);

export function parseArgs(argv: string[]): ParsedCommand {
  const [first, ...rest] = argv;

  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    return { kind: 'help' };
  }
  if (first === '-v' || first === '--version' || first === 'version') {
    return { kind: 'version' };
  }
  if (first === 'search') {
    return parseSearch(rest);
  }
  if (first === 'fetch') {
    return parseFetch(rest);
  }
  if (/^https?:\/\//i.test(first)) {
    return parseFetch(argv);
  }
  if (first.startsWith('-') && first !== '-') {
    // No command given: route known search options to a shorthand search so that
    // `dsearch -n 5 "query"` works like `dsearch "query" -n 5`.
    if (SHORTHAND_OPTIONS.has(splitOption(first).name)) {
      return parseSearch(argv);
    }
    throw new UsageError(`Unknown command or option: ${first}`);
  }

  return parseSearch(argv);
}

export interface CliDeps {
  out?: (message: string) => void;
  err?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetchImpl?: typeof fetch;
}

function apiHint(status: number): string | undefined {
  switch (status) {
    case 401:
      return 'Check that DEEPSEEK_API_KEY is valid.';
    case 402:
      return 'Your DeepSeek account has insufficient balance.';
    case 403:
      return 'The fetch request was rejected by the security policy.';
    case 404:
      return 'The page could not be fetched.';
    case 429:
      return 'Rate limit exceeded; wait a moment and retry.';
    default:
      return status >= 500 ? 'DeepSeek had a server error; retry in a moment.' : undefined;
  }
}

function writeMarkdown(path: string, markdown: string, cwd: string): void {
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown, 'utf8');
}

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? ((message: string) => console.log(message));
  const err = deps.err ?? ((message: string) => console.error(message));

  let command: ParsedCommand;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`Error: ${error.message}`);
      err('Run "dsearch --help" for usage.');
      return 2;
    }
    throw error;
  }

  if (command.kind === 'help') {
    out(HELP);
    return 0;
  }
  if (command.kind === 'version') {
    out(VERSION);
    return 0;
  }

  let config;
  try {
    config = loadConfig(deps.env, deps.cwd);
  } catch (error) {
    if (error instanceof ConfigError) {
      err(`Error: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const client = createClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetchImpl: deps.fetchImpl,
  });

  try {
    if (command.kind === 'search') {
      const response = await client.search(command.query, {
        count: command.count,
        needContent: command.needContent,
        oriQuestion: command.oriQuestion,
        localization: command.localization,
      });

      if (command.output) {
        const markdown = formatSearchMarkdown(command.query, response.results, {
          content: command.needContent,
        });
        writeMarkdown(command.output, markdown, deps.cwd ?? process.cwd());
        const total = response.results.length;
        out(`Wrote ${total} result${total === 1 ? '' : 's'} to ${command.output}`);
      } else {
        out(
          command.json
            ? JSON.stringify(response, null, 2)
            : formatSearchResults(command.query, response.results, { content: command.needContent }),
        );
      }
    } else {
      const page = await client.fetchPage(command.url);

      if (command.output) {
        writeMarkdown(command.output, formatPageMarkdown(command.url, page), deps.cwd ?? process.cwd());
        out(`Wrote page to ${command.output}`);
      } else {
        out(command.json ? JSON.stringify(page, null, 2) : formatPage(command.url, page));
      }
    }
    return 0;
  } catch (error) {
    if (error instanceof DeepSeekApiError) {
      err(`Error: ${error.message}`);
      const hint = apiHint(error.status);
      if (hint) err(hint);
      return 1;
    }

    err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
