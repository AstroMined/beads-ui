import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GRAPH_ISSUES_TYPE } from '../app/data/graph-subscription.js';
import { shouldDeriveReady } from './bd-version.js';
import { runBdJson } from './bd.js';
import { readManifestFingerprint } from './dolt-manifest.js';
import {
  BD_LIST_LIMIT,
  BD_LIST_UNLIMITED,
  CLOSED_ID_BATCH_MAX,
  GRAPH_ISSUE_FIELDS,
  fetchListForSubscription,
  isLiveIssue,
  mapSubscriptionToBdArgs,
  projectGraphIssue
} from './list-adapters.js';

vi.mock('./bd.js', () => ({ runBdJson: vi.fn() }));
vi.mock('./bd-version.js', () => ({ shouldDeriveReady: vi.fn() }));
vi.mock('./dolt-manifest.js', () => ({ readManifestFingerprint: vi.fn() }));

const runBdJsonMock = /** @type {import('vitest').Mock} */ (runBdJson);
const deriveMock = /** @type {import('vitest').Mock} */ (shouldDeriveReady);
const fingerprintMock = /** @type {import('vitest').Mock} */ (
  readManifestFingerprint
);

/** The shared open-set command. */
const OPEN_SET_ARGS = [
  'list',
  '--json',
  '--tree=false',
  '--limit',
  String(BD_LIST_UNLIMITED)
];

/** Fixed clock for the `closed-issues` floor. */
const NOW_ISO = '2026-11-08T12:00:00.000Z';
const SEVEN_DAYS_BEFORE_NOW_ISO = '2026-11-01T12:00:00.000Z';

/**
 * Number of bd JSON spawns whose subcommand is `name`.
 *
 * @param {string} name
 */
function spawnCount(name) {
  return runBdJsonMock.mock.calls.filter((call) => call[0][0] === name).length;
}

/**
 * Answer `bd list` with `open_rows` and `bd show` with the requested ids
 * found in `outside_rows`.
 *
 * @param {Array<Record<string, unknown>>} open_rows
 * @param {Array<{ id: string } & Record<string, unknown>>} [outside_rows]
 */
function answerBd(open_rows, outside_rows = []) {
  runBdJsonMock.mockImplementation(async (/** @type {string[]} */ args) => {
    if (args[0] === 'list') {
      return { code: 0, stdoutJson: open_rows };
    }
    if (args[0] === 'show') {
      return {
        code: 0,
        stdoutJson: outside_rows.filter((row) => args.includes(row.id))
      };
    }
    return { code: 1, stderr: 'unexpected' };
  });
}

describe('list adapters for subscription types', () => {
  beforeEach(() => {
    runBdJsonMock.mockReset();
    deriveMock.mockReset();
    fingerprintMock.mockReset();
    deriveMock.mockResolvedValue(false);
    fingerprintMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test('mapSubscriptionToBdArgs returns the open set for all-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'all-issues' });
    expect(args).toEqual(OPEN_SET_ARGS);
  });

  test('mapSubscriptionToBdArgs returns the open set for graph-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: GRAPH_ISSUES_TYPE });
    expect(args).toEqual(OPEN_SET_ARGS);
  });

  test('mapSubscriptionToBdArgs returns args for epics', () => {
    const args = mapSubscriptionToBdArgs({ type: 'epics' });
    expect(args).toEqual(['epic', 'status', '--json']);
  });

  test('mapSubscriptionToBdArgs returns args for blocked-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'blocked-issues' });
    // We choose dedicated subcommand mapping for blocked
    expect(args).toEqual(['blocked', '--json']);
  });

  test('mapSubscriptionToBdArgs returns args for ready-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'ready-issues' });
    expect(args).toEqual(['ready', '--limit', String(BD_LIST_LIMIT), '--json']);
  });

  test('mapSubscriptionToBdArgs returns the open set for in-progress-issues', () => {
    const args = mapSubscriptionToBdArgs({ type: 'in-progress-issues' });
    expect(args).toEqual(OPEN_SET_ARGS);
  });

  test('mapSubscriptionToBdArgs floors closed-issues at seven days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    const args = mapSubscriptionToBdArgs({ type: 'closed-issues' });
    expect(args).toEqual([
      'list',
      '--json',
      '--tree=false',
      '--status',
      'closed',
      '--closed-after',
      SEVEN_DAYS_BEFORE_NOW_ISO,
      '--limit',
      String(BD_LIST_LIMIT)
    ]);
  });

  test('mapSubscriptionToBdArgs returns args for status-issues with valid status', () => {
    const args = mapSubscriptionToBdArgs({
      type: 'status-issues',
      params: { status: 'in_review' }
    });
    expect(args).toEqual([
      'list',
      '--json',
      '--tree=false',
      '--status',
      'in_review',
      '--limit',
      String(BD_LIST_LIMIT)
    ]);
  });

  test('mapSubscriptionToBdArgs throws on missing status param', () => {
    expect(() => mapSubscriptionToBdArgs({ type: 'status-issues' })).toThrow(
      /Missing param: params\.status/
    );
  });

  test('mapSubscriptionToBdArgs throws on empty status param', () => {
    expect(() =>
      mapSubscriptionToBdArgs({
        type: 'status-issues',
        params: { status: '' }
      })
    ).toThrow(/Missing param: params\.status/);
  });

  test('mapSubscriptionToBdArgs returns args for issue-detail', () => {
    const args = mapSubscriptionToBdArgs({
      type: 'issue-detail',
      params: { id: 'UI-123' }
    });
    expect(args).toEqual(['show', 'UI-123', '--json']);
  });

  test('fetchListForSubscription returns normalized items (Date.parse)', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 0,
      stdoutJson: [
        {
          id: 'A-1',
          updated_at: '2024-01-01T00:00:00.000Z',
          closed_at: null,
          extra: 'x'
        },
        {
          id: 'A-2',
          updated_at: '2024-01-01T00:00:01.000Z',
          closed_at: '2024-01-01T00:00:05.000Z'
        },
        { id: 3, updated_at: 'not-a-date' }
      ]
    });
    const res = await fetchListForSubscription({ type: 'all-issues' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.length).toBe(3);
      expect(res.items[0]).toMatchObject({
        id: 'A-1',
        updated_at: Date.parse('2024-01-01T00:00:00.000Z'),
        closed_at: null
      });
      expect(res.items[1]).toMatchObject({
        id: 'A-2',
        updated_at: Date.parse('2024-01-01T00:00:01.000Z'),
        closed_at: Date.parse('2024-01-01T00:00:05.000Z')
      });
      // id coerced to string, closed_at defaults to null
      expect(res.items[2]).toMatchObject({
        id: '3',
        updated_at: 0,
        closed_at: null
      });
    }
  });

  test('filters tombstoned epics', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 0,
      stdoutJson: [
        {
          epic: {
            id: 'E-1',
            status: 'open',
            issue_type: 'epic',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
            closed_at: null
          },
          total_children: 1,
          closed_children: 0,
          eligible_for_close: false
        },
        {
          epic: {
            id: 'E-2',
            status: 'tombstone',
            issue_type: 'epic',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
            closed_at: null,
            deleted_at: '2024-02-01T00:00:00.000Z'
          },
          total_children: 0,
          closed_children: 0,
          eligible_for_close: false
        }
      ]
    });

    const res = await fetchListForSubscription({ type: 'epics' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        id: 'E-1',
        status: 'open'
      });
    }
  });

  test('fetchListForSubscription surfaces bd error', async () => {
    /** @type {import('vitest').Mock} */ (runBdJson).mockResolvedValue({
      code: 2,
      stderr: 'boom'
    });
    const res = await fetchListForSubscription({ type: 'all-issues' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('bd_error');
      expect(res.error.message).toContain('boom');
      expect(res.error.details && res.error.details.exit_code).toBe(2);
    }
  });

  test('fetchListForSubscription retries a transient bd failure then succeeds', async () => {
    const mock = /** @type {import('vitest').Mock} */ (runBdJson);
    // First attempt: transient failure with empty stderr (the observed race).
    // Second attempt: success.
    mock.mockResolvedValueOnce({ code: 1 }).mockResolvedValueOnce({
      code: 0,
      stdoutJson: [
        { id: 'A-1', updated_at: '2024-01-01T00:00:00.000Z', closed_at: null }
      ]
    });

    const res = await fetchListForSubscription({ type: 'blocked-issues' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ id: 'A-1' });
    }
    expect(mock).toHaveBeenCalledTimes(2);
  });

  test('fetchListForSubscription surfaces error after exhausting retries', async () => {
    const mock = /** @type {import('vitest').Mock} */ (runBdJson);
    // Every attempt fails with an empty stderr, like the observed transient.
    mock.mockResolvedValue({ code: 1 });

    const res = await fetchListForSubscription({ type: 'blocked-issues' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('bd_error');
      // Empty stderr falls back to the generic message.
      expect(res.error.message).toBe('bd failed');
      expect(res.error.details && res.error.details.exit_code).toBe(1);
    }
    // Default is 2 retries, so 3 attempts total.
    expect(mock).toHaveBeenCalledTimes(3);
  });

  test('fetchListForSubscription returns error for unknown type', async () => {
    const res = await fetchListForSubscription(
      /** @type {any} */ ({ type: 'unknown' })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('bad_request');
      expect(res.error.message).toMatch(/Unknown subscription type/);
    }
  });
});

describe('open set sharing', () => {
  beforeEach(() => {
    runBdJsonMock.mockReset();
    deriveMock.mockReset();
    fingerprintMock.mockReset();
    deriveMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const OPEN_ROWS = [
    { id: 'S-1', status: 'open', title: 'One' },
    { id: 'S-2', status: 'in_progress', title: 'Two' },
    { id: 'S-3', status: 'in_review', title: 'Three' }
  ];

  test('in-progress-issues filters the open set by status', async () => {
    fingerprintMock.mockReturnValue(null);
    answerBd(OPEN_ROWS);

    const res = await fetchListForSubscription(
      { type: 'in-progress-issues' },
      { cwd: '/ws/in-progress' }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.map((it) => it.id)).toEqual(['S-2']);
    }
    expect(runBdJsonMock).toHaveBeenCalledWith(OPEN_SET_ARGS, {
      cwd: '/ws/in-progress'
    });
  });

  test('an unchanged fingerprint reuses the rows; a new one refetches', async () => {
    fingerprintMock.mockReturnValue('fp-1');
    answerBd(OPEN_ROWS);
    const cwd = '/ws/fingerprint';

    await fetchListForSubscription({ type: 'all-issues' }, { cwd });
    await fetchListForSubscription({ type: 'in-progress-issues' }, { cwd });
    expect(spawnCount('list')).toBe(1);

    fingerprintMock.mockReturnValue('fp-2');
    await fetchListForSubscription({ type: 'all-issues' }, { cwd });
    expect(spawnCount('list')).toBe(2);
  });

  test('a null fingerprint shares a fetch only within one refresh pass', async () => {
    fingerprintMock.mockReturnValue(null);
    answerBd(OPEN_ROWS);
    const cwd = '/ws/no-manifest';
    const pass = Symbol('pass-1');

    await Promise.all([
      fetchListForSubscription({ type: 'all-issues' }, { cwd, pass }),
      fetchListForSubscription({ type: 'in-progress-issues' }, { cwd, pass })
    ]);
    expect(spawnCount('list')).toBe(1);

    await fetchListForSubscription({ type: 'all-issues' }, { cwd });
    expect(spawnCount('list')).toBe(2);

    await fetchListForSubscription(
      { type: 'all-issues' },
      { cwd, pass: Symbol('pass-2') }
    );
    expect(spawnCount('list')).toBe(3);
  });

  test('a null fingerprint never joins a pending fetch another caller started', async () => {
    fingerprintMock.mockReturnValue(null);
    const cwd = '/ws/no-manifest-pending';
    const before_write = [{ id: 'P-1', status: 'open', title: 'Before' }];
    const after_write = [{ id: 'P-1', status: 'open', title: 'After' }];
    /** @type {(value: { code: number, stdoutJson: unknown }) => void} */
    let finish_first = () => {};
    runBdJsonMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish_first = resolve;
          })
      )
      .mockResolvedValueOnce({ code: 0, stdoutJson: after_write });

    // A subscribe snapshot starts the spawn, a write lands, and the refresh
    // pass the write triggers asks for the open set while that spawn runs.
    const subscribe = fetchListForSubscription({ type: 'all-issues' }, { cwd });
    const refresh = fetchListForSubscription(
      { type: 'all-issues' },
      { cwd, pass: Symbol('pass-after-write') }
    );
    finish_first({ code: 0, stdoutJson: before_write });

    const refreshed = await refresh;
    await subscribe;
    expect(spawnCount('list')).toBe(2);
    expect(refreshed.ok && refreshed.items.map((it) => it.title)).toEqual([
      'After'
    ]);
  });

  test('a failed open set is not reused', async () => {
    vi.stubEnv('BDUI_BD_LIST_RETRIES', '0');
    fingerprintMock.mockReturnValue('fp-1');
    const cwd = '/ws/failure';
    runBdJsonMock
      .mockResolvedValueOnce({ code: 1, stderr: 'locked' })
      .mockResolvedValueOnce({ code: 0, stdoutJson: OPEN_ROWS });

    const first = await fetchListForSubscription(
      { type: 'all-issues' },
      { cwd }
    );
    const second = await fetchListForSubscription(
      { type: 'all-issues' },
      { cwd }
    );

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(spawnCount('list')).toBe(2);
  });

  test('tombstoned and deleted rows are dropped from the open set', async () => {
    fingerprintMock.mockReturnValue(null);
    answerBd([
      ...OPEN_ROWS,
      { id: 'S-4', status: 'tombstone' },
      { id: 'S-5', status: 'open', deleted_at: '2026-01-01T00:00:00Z' }
    ]);

    const res = await fetchListForSubscription(
      { type: 'all-issues' },
      { cwd: '/ws/tombstone' }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.map((it) => it.id)).toEqual(['S-1', 'S-2', 'S-3']);
    }
  });

  test('derived blocked rows keep the list fields and add blocked_by', async () => {
    fingerprintMock.mockReturnValue('fp-1');
    deriveMock.mockResolvedValue(true);
    answerBd([
      { id: 'B-1', status: 'open', title: 'Gate' },
      {
        id: 'B-2',
        status: 'open',
        title: 'Waits',
        dependencies: [{ depends_on_id: 'B-1', type: 'blocks' }]
      }
    ]);
    const cwd = '/ws/derived-fields';

    const blocked = await fetchListForSubscription(
      { type: 'blocked-issues' },
      { cwd }
    );
    const ready = await fetchListForSubscription(
      { type: 'ready-issues' },
      { cwd }
    );

    expect(blocked.ok && blocked.items).toEqual([
      expect.objectContaining({
        id: 'B-2',
        title: 'Waits',
        blocked_by: ['B-1'],
        blocked_by_count: 1
      })
    ]);
    expect(ready.ok && ready.items.map((it) => it.id)).toEqual(['B-1']);
    expect(spawnCount('list')).toBe(1);
    expect(deriveMock).toHaveBeenCalledWith(cwd);
  });
});

describe('graph-issues', () => {
  beforeEach(() => {
    runBdJsonMock.mockReset();
    fingerprintMock.mockReset();
    fingerprintMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** An open bead blocked by a closed bead outside the open set. */
  const BLOCKED_CHILD = {
    id: 'F-1',
    status: 'open',
    dependencies: [{ depends_on_id: 'F-DONE', type: 'blocks' }]
  };

  test('a failed bd show is retried by the next fetch and marks it partial', async () => {
    vi.stubEnv('BDUI_BD_LIST_RETRIES', '0');
    const cwd = '/ws/graph-show-failure';
    answerBd([BLOCKED_CHILD], [{ id: 'F-DONE', status: 'closed' }]);
    runBdJsonMock.mockImplementationOnce(async () => ({
      code: 0,
      stdoutJson: [BLOCKED_CHILD]
    }));
    runBdJsonMock.mockImplementationOnce(async () => ({
      code: 1,
      stderr: 'database is locked'
    }));

    const failed = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd }
    );
    expect(failed.ok && failed.items.map((it) => it.id)).toEqual(['F-1']);
    expect(failed.ok && failed.partial).toBe(true);

    const retried = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd }
    );
    expect(spawnCount('show')).toBe(2);
    expect(retried.ok && retried.items.map((it) => it.id)).toEqual([
      'F-1',
      'F-DONE'
    ]);
    expect(retried.ok && retried.partial).toBeUndefined();
  });

  test('bd show reporting every id missing caches them as missing', async () => {
    vi.stubEnv('BDUI_BD_LIST_RETRIES', '0');
    const cwd = '/ws/graph-show-not-found';
    runBdJsonMock.mockImplementation(async (/** @type {string[]} */ args) =>
      args[0] === 'list'
        ? { code: 0, stdoutJson: [BLOCKED_CHILD] }
        : { code: 1, stderr: 'Error: no issue found matching "F-DONE"' }
    );

    const first = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd }
    );
    await fetchListForSubscription({ type: GRAPH_ISSUES_TYPE }, { cwd });

    expect(first.ok && first.partial).toBeUndefined();
    expect(spawnCount('show')).toBe(1);
  });

  test('projectGraphIssue keeps the graph fields and reduces edges', () => {
    const row = projectGraphIssue({
      id: 'G-1',
      title: 'Node',
      status: 'open',
      priority: 1,
      issue_type: 'task',
      assignee: 'ryan',
      parent: 'G-0',
      labels: ['ui'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      description: 'dropped',
      dependency_count: 3,
      dependencies: [
        { depends_on_id: 'G-0', type: 'parent-child' },
        { depends_on_id: 'G-2', type: 'blocks' },
        { depends_on_id: 'G-2', type: 'blocks' },
        { id: 'G-3', dependency_type: 'related', title: 'detail shape' },
        { type: 'blocks' }
      ]
    });

    expect(row).toEqual({
      id: 'G-1',
      title: 'Node',
      status: 'open',
      priority: 1,
      issue_type: 'task',
      assignee: 'ryan',
      parent: 'G-0',
      labels: ['ui'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      dependencies: [
        { depends_on_id: 'G-0', type: 'parent-child' },
        { depends_on_id: 'G-2', type: 'blocks' },
        { depends_on_id: 'G-3', type: 'related' }
      ]
    });
    for (const key of Object.keys(row)) {
      expect([...GRAPH_ISSUE_FIELDS, 'dependencies']).toContain(key);
    }
  });

  test('adds referenced rows outside the open set with their real status', async () => {
    answerBd(
      [
        {
          id: 'G-1',
          status: 'open',
          parent: 'G-EP',
          dependencies: [
            { depends_on_id: 'G-EP', type: 'parent-child' },
            { depends_on_id: 'G-DONE', type: 'blocks' },
            { depends_on_id: 'external:proj:cap', type: 'blocks' }
          ]
        }
      ],
      [
        { id: 'G-EP', status: 'closed', closed_at: '2026-01-03T00:00:00Z' },
        { id: 'G-DONE', status: 'closed', description: 'dropped' }
      ]
    );

    const res = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd: '/ws/graph-outside' }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.map((it) => [it.id, it.status])).toEqual([
        ['G-1', 'open'],
        ['G-DONE', 'closed'],
        ['G-EP', 'closed']
      ]);
      expect(res.items[2].closed_at).toBe(Date.parse('2026-01-03T00:00:00Z'));
      expect(res.items[1]).not.toHaveProperty('description');
    }
    expect(runBdJsonMock).toHaveBeenCalledWith(
      ['show', 'G-DONE', 'G-EP', '--json'],
      { cwd: '/ws/graph-outside' }
    );
  });

  test('caches resolved and missing ids until they reappear in the open set', async () => {
    const cwd = '/ws/graph-cache';
    const child = {
      id: 'C-1',
      status: 'open',
      dependencies: [
        { depends_on_id: 'C-DONE', type: 'blocks' },
        { depends_on_id: 'C-GONE', type: 'blocks' }
      ]
    };
    answerBd([child], [{ id: 'C-DONE', status: 'closed' }]);

    await fetchListForSubscription({ type: GRAPH_ISSUES_TYPE }, { cwd });
    await fetchListForSubscription({ type: GRAPH_ISSUES_TYPE }, { cwd });
    expect(spawnCount('show')).toBe(1);

    // C-DONE is reopened: it is served from the open set, once.
    answerBd([child, { id: 'C-DONE', status: 'open' }]);
    const reopened = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd }
    );
    expect(reopened.ok && reopened.items.map((it) => it.id)).toEqual([
      'C-1',
      'C-DONE'
    ]);
    expect(spawnCount('show')).toBe(1);

    // Closed again: the dropped id is resolved again, the missing one is not.
    answerBd([child], [{ id: 'C-DONE', status: 'closed' }]);
    await fetchListForSubscription({ type: GRAPH_ISSUES_TYPE }, { cwd });
    expect(spawnCount('show')).toBe(2);
    expect(runBdJsonMock).toHaveBeenLastCalledWith(
      ['show', 'C-DONE', '--json'],
      { cwd }
    );
  });

  test('splits outside ids into batches of CLOSED_ID_BATCH_MAX', async () => {
    const outside_ids = Array.from(
      { length: CLOSED_ID_BATCH_MAX + 1 },
      (_, i) => `X-${String(i).padStart(4, '0')}`
    );
    answerBd(
      [
        {
          id: 'X-ROOT',
          status: 'open',
          dependencies: outside_ids.map((id) => ({
            depends_on_id: id,
            type: 'related'
          }))
        }
      ],
      outside_ids.map((id) => ({ id, status: 'closed' }))
    );

    const res = await fetchListForSubscription(
      { type: GRAPH_ISSUES_TYPE },
      { cwd: '/ws/graph-batches' }
    );

    expect(res.ok && res.items).toHaveLength(CLOSED_ID_BATCH_MAX + 2);
    const show_sizes = runBdJsonMock.mock.calls
      .filter((call) => call[0][0] === 'show')
      .map((call) => call[0].length - 2);
    expect(show_sizes).toEqual([CLOSED_ID_BATCH_MAX, 1]);
  });
});

describe('isLiveIssue', () => {
  test('rejects tombstones, deleted rows and non-objects', () => {
    expect(isLiveIssue({ id: 'L-1', status: 'open' })).toBe(true);
    expect(isLiveIssue({ id: 'L-1', deleted_at: null })).toBe(true);
    expect(isLiveIssue({ id: 'L-1', status: 'tombstone' })).toBe(false);
    expect(isLiveIssue({ id: 'L-1', deleted_at: '2026-01-01' })).toBe(false);
    expect(isLiveIssue(null)).toBe(false);
    expect(isLiveIssue('L-1')).toBe(false);
  });
});
