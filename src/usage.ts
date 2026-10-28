import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configDir } from './config.js';

export type UsageKind = 'search' | 'fetch';

export interface UsageEntry {
  /** ISO 8601 timestamp of the successful request. */
  ts: string;
  kind: UsageKind;
}

/** DeepSeek bills $0.75 per 1,000 successful Search or Fetch requests. */
export const PRICE_PER_REQUEST_USD = 0.00075;

const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_WINDOW_DAYS = 30;

/** Path of the local, append-only request ledger. */
export function usagePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'usage.jsonl');
}

export interface RecordUsageOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

/**
 * Append one billable request to the local ledger. Tracking is best-effort:
 * a failed write must never turn a successful, already-billed API call into an error.
 */
export function recordUsage(kind: UsageKind, options: RecordUsageOptions = {}): void {
  const target = usagePath(options.env);
  const entry: UsageEntry = { ts: (options.now ?? new Date()).toISOString(), kind };

  try {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ignore an unreadable or unwritable config directory.
  }
}

function parseEntry(line: string): UsageEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return undefined;

    const { ts, kind } = parsed as { ts?: unknown; kind?: unknown };
    if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts))) return undefined;
    if (kind !== 'search' && kind !== 'fetch') return undefined;

    return { ts, kind };
  } catch {
    return undefined;
  }
}

/** Read the ledger, skipping malformed lines and a missing file. */
export function readUsage(env: NodeJS.ProcessEnv = process.env): UsageEntry[] {
  let contents: string;
  try {
    contents = readFileSync(usagePath(env), 'utf8');
  } catch {
    return [];
  }

  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseEntry)
    .filter((entry): entry is UsageEntry => entry !== undefined);
}

export type UsageWindowId = 'today' | 'last7Days' | 'last30Days' | 'allTime';

export interface UsageWindow {
  id: UsageWindowId;
  label: string;
  searches: number;
  fetches: number;
  requests: number;
  costUsd: number;
}

export interface UsageSummary {
  pricePerRequestUsd: number;
  windows: UsageWindow[];
  /** Average billable requests per week over the last 30 days. */
  averagePerWeek: number;
}

function roundCost(requests: number): number {
  return Math.round(requests * PRICE_PER_REQUEST_USD * 1_000_000) / 1_000_000;
}

/**
 * Summarize the ledger over rolling windows. "Today" starts at local midnight;
 * the other windows end at `now` and reach back 7 or 30 days.
 */
export function summarizeUsage(entries: UsageEntry[], now: Date = new Date()): UsageSummary {
  const nowMs = now.getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const buckets = [
    { id: 'today' as const, label: 'Today', start: startOfToday, searches: 0, fetches: 0 },
    { id: 'last7Days' as const, label: 'Last 7 days', start: nowMs - 7 * DAY_MS, searches: 0, fetches: 0 },
    { id: 'last30Days' as const, label: 'Last 30 days', start: nowMs - 30 * DAY_MS, searches: 0, fetches: 0 },
    { id: 'allTime' as const, label: 'All time', start: 0, searches: 0, fetches: 0 },
  ];

  for (const entry of entries) {
    const ts = Date.parse(entry.ts);
    if (!Number.isFinite(ts)) continue;

    for (const bucket of buckets) {
      if (ts < bucket.start) continue;
      if (entry.kind === 'search') bucket.searches += 1;
      else bucket.fetches += 1;
    }
  }

  const windows: UsageWindow[] = buckets.map(({ id, label, searches, fetches }) => {
    const requests = searches + fetches;
    return { id, label, searches, fetches, requests, costUsd: roundCost(requests) };
  });

  const last30Days = windows.find((window) => window.id === 'last30Days')!;
  const averagePerWeek =
    Math.round((last30Days.requests / (AVERAGE_WINDOW_DAYS / 7)) * 10) / 10;

  return { pricePerRequestUsd: PRICE_PER_REQUEST_USD, windows, averagePerWeek };
}
