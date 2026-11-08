import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GRAPH_ISSUES_TYPE } from '../app/data/graph-subscription.js';
import {
  DERIVED_READY_BD_VERSION,
  getBdVersion,
  parseBdVersion,
  resetBdVersion,
  shouldDeriveReady
} from './bd-version.js';
import { runBd, runBdJson } from './bd.js';
import { readManifestFingerprint } from './dolt-manifest.js';
import { fetchListForSubscription } from './list-adapters.js';

vi.mock('./bd.js', () => ({ runBd: vi.fn(), runBdJson: vi.fn() }));
vi.mock('./dolt-manifest.js', () => ({ readManifestFingerprint: vi.fn() }));

/** The bd 0.63.3 ready/blocked capture, relative to this file. */
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/bd-ready-parity.json'
);

/**
 * @type {{
 *   bd_version: string,
 *   captured_at: string,
 *   open_set: Array<{ id: string } & Record<string, unknown>>,
 *   outside_open_set: Array<{ id: string, status: string }>,
 *   ready_ids: string[],
 *   blocked: Array<{ id: string, blocked_by: string[], blocked_by_count: number }>,
 *   blocked_ids: string[]
 * }}
 */
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/** A bd release other than the derived one. */
const OTHER_BD_VERSION = '0.64.0';

/** Workspace fingerprint that stays the same for one refresh pass. */
const PASS_FINGERPRINT = 'manifest-fp-1';

const OPEN_SET_TYPES = [
  GRAPH_ISSUES_TYPE,
  'in-progress-issues',
  'ready-issues',
  'blocked-issues'
];

const runBdMock = /** @type {import('vitest').Mock} */ (runBd);
const runBdJsonMock = /** @type {import('vitest').Mock} */ (runBdJson);
const fingerprintMock = /** @type {import('vitest').Mock} */ (
  readManifestFingerprint
);

/**
 * Answer bd like the captured workspace: `list` returns the open set, `show`
 * the requested outside rows, and `ready` / `blocked` the captured lists.
 *
 * @param {string[]} args
 */
async function fakeBdJson(args) {
  if (args[0] === 'list') {
    return { code: 0, stdoutJson: FIXTURE.open_set };
  }
  if (args[0] === 'show') {
    return {
      code: 0,
      stdoutJson: FIXTURE.outside_open_set.filter((row) =>
        args.includes(row.id)
      )
    };
  }
  if (args[0] === 'ready') {
    return {
      code: 0,
      stdoutJson: FIXTURE.ready_ids.map((id) => ({ id, status: 'open' }))
    };
  }
  if (args[0] === 'blocked') {
    return { code: 0, stdoutJson: FIXTURE.blocked };
  }
  return { code: 1, stderr: `unexpected bd ${args.join(' ')}` };
}

/**
 * @param {string} version
 */
function bdVersionOutput(version) {
  return { code: 0, stdout: `bd version ${version} (c08f18a4)\n`, stderr: '' };
}

/**
 * Number of bd JSON spawns whose subcommand is `name`.
 *
 * @param {string} name
 */
function spawnCount(name) {
  return runBdJsonMock.mock.calls.filter((call) => call[0][0] === name).length;
}

/**
 * Fetch every open-set type for one refresh pass in `cwd`.
 *
 * @param {string} cwd
 */
async function fetchPass(cwd) {
  const results = await Promise.all(
    OPEN_SET_TYPES.map((type) => fetchListForSubscription({ type }, { cwd }))
  );
  /** @type {Map<string, Array<{ id: string } & Record<string, unknown>>>} */
  const by_type = new Map();
  results.forEach((res, i) => {
    expect(res.ok).toBe(true);
    by_type.set(OPEN_SET_TYPES[i], res.ok ? res.items : []);
  });
  return by_type;
}

describe('derived ready and blocked lists', () => {
  beforeEach(() => {
    runBdMock.mockReset();
    runBdJsonMock.mockReset();
    fingerprintMock.mockReset();
    runBdJsonMock.mockImplementation(fakeBdJson);
    fingerprintMock.mockReturnValue(PASS_FINGERPRINT);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXTURE.captured_at));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('the fixture was captured from the derived bd version', () => {
    expect(FIXTURE.bd_version).toBe(DERIVED_READY_BD_VERSION);
  });

  test('derives bd 0.63.3 ready and blocked from one open-set spawn', async () => {
    runBdMock.mockResolvedValue(bdVersionOutput(DERIVED_READY_BD_VERSION));

    const by_type = await fetchPass('/ws/derived');

    const ready = by_type.get('ready-issues') ?? [];
    const blocked = by_type.get('blocked-issues') ?? [];
    expect(ready.map((it) => it.id).sort()).toEqual(FIXTURE.ready_ids);
    expect(blocked.map((it) => it.id)).toEqual(FIXTURE.blocked_ids);
    expect(
      blocked.map((it) => ({
        id: it.id,
        blocked_by: it.blocked_by,
        blocked_by_count: it.blocked_by_count
      }))
    ).toEqual(
      FIXTURE.blocked.map((b) => ({
        id: b.id,
        blocked_by: b.blocked_by,
        blocked_by_count: b.blocked_by_count
      }))
    );
    expect(spawnCount('list')).toBe(1);

    // A later pass under the same fingerprint reuses the rows.
    for (const type of OPEN_SET_TYPES) {
      const res = await fetchListForSubscription(
        { type },
        { cwd: '/ws/derived' }
      );
      expect(res.ok).toBe(true);
    }
    expect(spawnCount('list')).toBe(1);
    expect(spawnCount('ready')).toBe(0);
    expect(spawnCount('blocked')).toBe(0);
    expect(runBdMock).toHaveBeenCalledTimes(1);
    expect(runBdMock).toHaveBeenCalledWith(['--version'], {
      cwd: '/ws/derived'
    });
  });

  test('in-progress-issues is the open set filtered by status', async () => {
    runBdMock.mockResolvedValue(bdVersionOutput(DERIVED_READY_BD_VERSION));

    const by_type = await fetchPass('/ws/in-progress');

    const expected = FIXTURE.open_set
      .filter((row) => row.status === 'in_progress')
      .map((row) => row.id)
      .sort();
    const in_progress = by_type.get('in-progress-issues') ?? [];
    expect(in_progress.map((it) => it.id).sort()).toEqual(expected);
  });

  test('graph-issues carries the open set plus referenced closed rows', async () => {
    runBdMock.mockResolvedValue(bdVersionOutput(DERIVED_READY_BD_VERSION));

    const by_type = await fetchPass('/ws/graph');

    const graph = by_type.get(GRAPH_ISSUES_TYPE) ?? [];
    const by_id = new Map(graph.map((it) => [it.id, it]));
    for (const row of FIXTURE.open_set) {
      expect(by_id.has(row.id)).toBe(true);
    }
    expect(by_id.get('pw-done-blocker')).toMatchObject({ status: 'closed' });
    expect(by_id.get('pw-st-pinned')).toMatchObject({ status: 'pinned' });
    expect(spawnCount('show')).toBe(1);
  });

  test('another bd version spawns bd ready and bd blocked', async () => {
    runBdMock.mockResolvedValue(bdVersionOutput(OTHER_BD_VERSION));

    const by_type = await fetchPass('/ws/fallback');

    const ready = by_type.get('ready-issues') ?? [];
    const blocked = by_type.get('blocked-issues') ?? [];
    expect(ready.map((it) => it.id)).toEqual(FIXTURE.ready_ids);
    expect(blocked.map((it) => it.id)).toEqual(FIXTURE.blocked_ids);
    expect(spawnCount('ready')).toBe(1);
    expect(spawnCount('blocked')).toBe(1);
    expect(spawnCount('list')).toBe(1);
  });
});

describe('bd version', () => {
  beforeEach(() => {
    runBdMock.mockReset();
  });

  test('parseBdVersion extracts the semver', () => {
    expect(parseBdVersion('bd version 0.63.3 (c08f18a4)\n')).toBe('0.63.3');
    expect(parseBdVersion('no version here')).toBe(null);
  });

  test('getBdVersion runs bd --version once per workspace', async () => {
    runBdMock.mockResolvedValue(bdVersionOutput(DERIVED_READY_BD_VERSION));

    const [first, second] = await Promise.all([
      getBdVersion('/ws/memo'),
      getBdVersion('/ws/memo')
    ]);
    const third = await getBdVersion('/ws/memo');

    expect([first, second, third]).toEqual([
      DERIVED_READY_BD_VERSION,
      DERIVED_READY_BD_VERSION,
      DERIVED_READY_BD_VERSION
    ]);
    expect(runBdMock).toHaveBeenCalledTimes(1);
  });

  test('resetBdVersion makes the next call read bd --version again', async () => {
    runBdMock
      .mockResolvedValueOnce(bdVersionOutput(DERIVED_READY_BD_VERSION))
      .mockResolvedValueOnce(bdVersionOutput(OTHER_BD_VERSION));

    expect(await shouldDeriveReady('/ws/upgraded')).toBe(true);
    resetBdVersion('/ws/upgraded');

    expect(await shouldDeriveReady('/ws/upgraded')).toBe(false);
    expect(runBdMock).toHaveBeenCalledTimes(2);
  });

  test('a failed read is retried on the next call and never derives', async () => {
    runBdMock
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'boom' })
      .mockResolvedValueOnce(bdVersionOutput(DERIVED_READY_BD_VERSION));

    expect(await shouldDeriveReady('/ws/retry')).toBe(false);
    expect(await shouldDeriveReady('/ws/retry')).toBe(true);
    expect(runBdMock).toHaveBeenCalledTimes(2);
  });
});
