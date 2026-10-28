import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRICE_PER_REQUEST_USD,
  readUsage,
  recordUsage,
  summarizeUsage,
  usagePath,
  type UsageEntry,
} from '../src/usage.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsearch-usage-'));
  tempDirs.push(dir);
  return dir;
}

function isolatedEnv(): NodeJS.ProcessEnv {
  const dir = tempDir();
  return process.platform === 'win32' ? { APPDATA: dir } : { XDG_CONFIG_HOME: dir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('usagePath', () => {
  it('stores the ledger beside the user config file', () => {
    const env = isolatedEnv();
    const base = process.platform === 'win32' ? env.APPDATA! : env.XDG_CONFIG_HOME!;

    expect(usagePath(env)).toBe(join(base, 'dsearch', 'usage.jsonl'));
  });
});

describe('recordUsage and readUsage', () => {
  it('appends entries in order', () => {
    const env = isolatedEnv();
    const first = new Date('2026-10-28T05:00:00.000Z');
    const second = new Date('2026-10-28T06:00:00.000Z');

    recordUsage('search', { env, now: first });
    recordUsage('fetch', { env, now: second });

    expect(readUsage(env)).toEqual([
      { ts: first.toISOString(), kind: 'search' },
      { ts: second.toISOString(), kind: 'fetch' },
    ]);
    expect(readFileSync(usagePath(env), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('returns no entries when the ledger is missing', () => {
    expect(readUsage(isolatedEnv())).toEqual([]);
  });

  it('skips malformed lines and invalid entries', () => {
    const env = isolatedEnv();
    const target = usagePath(env);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        'not json',
        '',
        '{"ts":"not a date","kind":"search"}',
        '{"ts":"2026-10-28T05:00:00.000Z","kind":"other"}',
        '{"ts":"2026-10-28T05:00:00.000Z","kind":"search"}',
        '[]',
      ].join('\r\n'),
    );

    expect(readUsage(env)).toEqual([{ ts: '2026-10-28T05:00:00.000Z', kind: 'search' }]);
  });

  it('does not throw when the ledger cannot be written', () => {
    const dir = tempDir();
    // A file where the `dsearch` directory belongs makes mkdir fail.
    writeFileSync(join(dir, 'dsearch'), '');
    const env = process.platform === 'win32' ? { APPDATA: dir } : { XDG_CONFIG_HOME: dir };

    expect(() => recordUsage('search', { env, now: new Date() })).not.toThrow();
  });
});

describe('summarizeUsage', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);
  const DAY_MS = 24 * 60 * 60 * 1000;

  function at(daysAgo: number, hoursAgo = 0): string {
    return new Date(now.getTime() - daysAgo * DAY_MS - hoursAgo * 60 * 60 * 1000).toISOString();
  }

  it('counts entries in rolling windows and estimates cost', () => {
    const entries: UsageEntry[] = [
      { ts: at(0, 1), kind: 'search' },
      { ts: at(2), kind: 'search' },
      { ts: at(2), kind: 'fetch' },
      { ts: at(10), kind: 'search' },
      { ts: at(40), kind: 'fetch' },
    ];

    const summary = summarizeUsage(entries, now);
    const windows = new Map(summary.windows.map((window) => [window.id, window]));

    expect(summary.pricePerRequestUsd).toBe(PRICE_PER_REQUEST_USD);
    expect(windows.get('today')).toMatchObject({ searches: 1, fetches: 0, requests: 1, costUsd: 0.00075 });
    expect(windows.get('last7Days')).toMatchObject({ searches: 2, fetches: 1, requests: 3, costUsd: 0.00225 });
    expect(windows.get('last30Days')).toMatchObject({ searches: 3, fetches: 1, requests: 4, costUsd: 0.003 });
    expect(windows.get('allTime')).toMatchObject({ searches: 3, fetches: 2, requests: 5, costUsd: 0.00375 });
    expect(summary.averagePerWeek).toBe(0.9);
  });

  it('returns zeroes for an empty ledger', () => {
    const summary = summarizeUsage([], now);

    expect(summary.windows.every((window) => window.requests === 0)).toBe(true);
    expect(summary.averagePerWeek).toBe(0);
  });

  it('skips entries with invalid timestamps', () => {
    expect(summarizeUsage([{ ts: 'not a date', kind: 'search' }], now).windows[3]).toMatchObject({
      requests: 0,
    });
  });
});
