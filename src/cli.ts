import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createClient, DeepSeekApiError } from './client.js';
import { ConfigError, loadConfig, saveApiKey } from './config.js';
import { formatPage, formatPageMarkdown, formatSearchMarkdown, formatSearchResults, formatUsage, unescapeMarkdown } from './format.js';
import { readUsage, recordUsage, summarizeUsage, usagePath } from './usage.js';
import { VERSION } from './version.js';

export const HELP = `dsearch — DeepSeek web search from the terminal

Usage:
  dsearch search <query...> [options]
  dsearch fetch <url> [options]
  dsearch auth
  dsearch cost [--json]
  dsearch "<query>" [options]
  dsearch <url> [options]

Commands:
  search <query...>   Search the web with DeepSeek
  fetch <url>         Fetch a single page as Markdown
  auth                Save your DeepSeek API key for all projects
  cost                Show request counts and estimated cost

Search options:
  -n, --count <1-50>       Number of results to return (default 10)
      --content            Include full page content in each result
      --ori-question <q>   Original user question, improves query understanding
      --localization <ip>  IP address used to localize results
  -j, --json               Print the raw API response as JSON

Fetch options:
  -j, --json               Print the raw API response as JSON
      --clean              Unescape Markdown punctuation in the fetched content

Cost options:
  -j, --json               Print usage stats as JSON

Global options:
  -o, --output <file>  Write to a file instead of stdout (JSON with --json, Markdown otherwise)
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  DEEPSEEK_API_KEY    Required. Also read from ./.env or the 'dsearch auth' key
  DEEPSEEK_BASE_URL   Optional API base URL (default https://api.deepseek.com)

  Inject a key per command instead of saving one:  op run -- dsearch "query"

Examples:
  dsearch auth
  dsearch cost
  dsearch search "DeepSeek V4 release"
  dsearch "DeepSeek site:github.com after:2025" -n 5 --json
  dsearch "DeepSeek V4 release" -o results.md
  dsearch "DeepSeek V4 release" -j -o results.json
  dsearch https://api-docs.deepseek.com/guides/search
  dsearch fetch https://api-docs.deepseek.com/guides/search --output docs/search.md
  dsearch fetch https://api-docs.deepseek.com/guides/search --clean -o docs/search.md`;

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
  clean: boolean;
  output?: string;
}

export interface CostCommand {
  kind: 'cost';
  json: boolean;
}

export type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'auth' }
  | CostCommand
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
        case '-j':
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
  let clean = false;
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

    if (!endOfOptions && (token === '-j' || token === '--json')) {
      json = true;
      index += 1;
      continue;
    }

    if (!endOfOptions && token === '--clean') {
      clean = true;
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

  if (json && clean) {
    throw new UsageError('--clean cannot be combined with --json.');
  }

  validateUrl(url);
  return { kind: 'fetch', url, json, clean, output };
}

function parseCost(tokens: string[]): ParsedCommand {
  let json = false;

  for (const token of tokens) {
    if (token === '-h' || token === '--help') return { kind: 'help' };
    if (token === '-j' || token === '--json') {
      json = true;
      continue;
    }
    throw new UsageError(token.startsWith('-') ? `Unknown option: ${token}` : 'cost takes no arguments.');
  }

  return { kind: 'cost', json };
}

/** Search options that may appear before the query in shorthand mode. */
const SHORTHAND_OPTIONS = new Set([
  '-n',
  '--count',
  '--content',
  '--ori-question',
  '--localization',
  '-j',
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
  if (first === 'auth') {
    if (rest.length > 0) throw new UsageError('auth takes no arguments.');
    return { kind: 'auth' };
  }
  if (first === 'cost') {
    return parseCost(rest);
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
  stdin?: NodeJS.ReadStream;
  /** Fixed clock, primarily for tests. */
  now?: Date;
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

function writeOutput(path: string, contents: string, cwd: string): void {
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

function readPipedKey(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((succeed, fail) => {
    const chunks: string[] = [];
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => chunks.push(chunk));
    stream.on('end', () => succeed(chunks.join('').trim()));
    stream.on('error', fail);
    stream.resume();
  });
}

/** Read the key from a TTY without echoing it. */
function readTtyKey(stdin: NodeJS.ReadStream): Promise<string> {
  return new Promise((succeed, fail) => {
    let key = '';

    const finish = (result: string | UsageError) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      if (result instanceof UsageError) fail(result);
      else succeed(result);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(key.trim());
        if (char === '\u0003') return finish(new UsageError('Cancelled.'));
        if (char === '\u007f' || char === '\b') {
          key = key.slice(0, -1);
          continue;
        }
        key += char;
      }
    };

    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function runAuth(deps: CliDeps): Promise<number> {
  const out = deps.out ?? ((message: string) => console.log(message));
  const err = deps.err ?? ((message: string) => console.error(message));
  const stdin = deps.stdin ?? process.stdin;
  const piped = !stdin.isTTY;

  try {
    if (!piped) process.stdout.write('DeepSeek API key (input hidden): ');
    const apiKey = (piped ? await readPipedKey(stdin) : await readTtyKey(stdin)).trim();
    if (!apiKey) throw new UsageError(piped ? 'No API key on stdin.' : 'No API key entered.');
    if (/\s/.test(apiKey)) throw new UsageError('API key must not contain whitespace.');

    const target = saveApiKey(apiKey, deps.env);
    out(`Saved API key to ${target}`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`Error: ${error.message}`);
      return 2;
    }
    err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
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
  if (command.kind === 'auth') {
    return runAuth(deps);
  }
  if (command.kind === 'cost') {
    const summary = summarizeUsage(readUsage(deps.env), deps.now);
    out(
      command.json
        ? JSON.stringify({ ...summary, usageFile: usagePath(deps.env) }, null, 2)
        : formatUsage(summary),
    );
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

  // Writing to a file prints a confirmation separated from earlier output by a blank line.
  const save = (path: string, contents: string, message: string) => {
    writeOutput(path, contents, deps.cwd ?? process.cwd());
    out(`\n${message}`);
  };

  try {
    if (command.kind === 'search') {
      const response = await client.search(command.query, {
        count: command.count,
        needContent: command.needContent,
        oriQuestion: command.oriQuestion,
        localization: command.localization,
      });

      // DeepSeek bills only successful requests that produce a result.
      if (response.results.length > 0) recordUsage('search', { env: deps.env, now: deps.now });

      if (command.output) {
        const total = response.results.length;
        if (command.json) {
          save(command.output, `${JSON.stringify(response, null, 2)}\n`, `Wrote JSON to ${command.output}`);
        } else {
          save(
            command.output,
            formatSearchMarkdown(command.query, response.results, { content: command.needContent }),
            `Wrote ${total} result${total === 1 ? '' : 's'} to ${command.output}`,
          );
        }
      } else {
        out(
          command.json
            ? JSON.stringify(response, null, 2)
            : formatSearchResults(command.query, response.results, { content: command.needContent }),
        );
      }
    } else {
      const page = await client.fetchPage(command.url);

      // DeepSeek bills a fetch only when it returns page content.
      if (page.content.trim()) recordUsage('fetch', { env: deps.env, now: deps.now });

      const rendered = command.clean ? { ...page, content: unescapeMarkdown(page.content) } : page;

      if (command.output) {
        if (command.json) {
          save(command.output, `${JSON.stringify(page, null, 2)}\n`, `Wrote JSON to ${command.output}`);
        } else {
          save(command.output, formatPageMarkdown(command.url, rendered), `Wrote page to ${command.output}`);
        }
      } else {
        out(command.json ? JSON.stringify(page, null, 2) : formatPage(command.url, rendered));
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
