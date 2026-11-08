import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { currentBdPriority } from './bd-priority.js';
import { runBd } from './bd.js';
import { readManifestFingerprint } from './dolt-manifest.js';
import { fetchListForSubscription } from './list-adapters.js';
import { attachWsServer, handleMessage, scheduleListRefresh } from './ws.js';

const { log_spy } = vi.hoisted(() => ({ log_spy: vi.fn() }));

vi.mock('./logging.js', () => ({ debug: () => log_spy }));
vi.mock('./bd.js', () => ({ runBdJson: vi.fn(), runBd: vi.fn() }));
vi.mock('./dolt-manifest.js', () => ({ readManifestFingerprint: vi.fn() }));
vi.mock('./list-adapters.js', () => ({ fetchListForSubscription: vi.fn() }));

const DEBOUNCE_MS = 50;
const MUTATION_WINDOW_MS = 500;
const SKIP_LOG = 'refresh pass skipped: manifest unchanged (%s)';

const mock_fetch = /** @type {import('vitest').Mock} */ (
  fetchListForSubscription
);
const mock_fingerprint = /** @type {import('vitest').Mock} */ (
  readManifestFingerprint
);
const mock_run = /** @type {import('vitest').Mock} */ (runBd);

/** @type {string | null} */
let fingerprint = null;
/** @type {string[]} */
const temp_dirs = [];

const ITEMS = [
  { id: 'A', updated_at: 1, closed_at: null },
  { id: 'B', updated_at: 1, closed_at: null }
];

function makeSocket() {
  return {
    sent: /** @type {string[]} */ ([]),
    readyState: 1,
    OPEN: 1,
    /** @param {string} msg */
    send(msg) {
      this.sent.push(String(msg));
    }
  };
}

/**
 * Attach a fresh server with one connected client subscribed to all-issues.
 */
async function setup() {
  const server = createServer();
  const handle = attachWsServer(server, {
    path: '/ws',
    refresh_debounce_ms: DEBOUNCE_MS
  });
  const client = makeSocket();
  handle.wss.clients.add(/** @type {any} */ (client));
  await handleMessage(
    /** @type {any} */ (client),
    Buffer.from(
      JSON.stringify({
        id: 'l1',
        type: /** @type {any} */ ('subscribe-list'),
        payload: { id: 'c1', type: 'all-issues' }
      })
    )
  );
  mock_fetch.mockClear();
  log_spy.mockClear();
  return handle;
}

/**
 * Schedule a watcher-driven pass and let its debounce elapse.
 */
async function watcherPass() {
  scheduleListRefresh();
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
}

/**
 * @returns {{ promise: Promise<{ ok: true, items: typeof ITEMS }>, resolve: () => void }}
 */
function deferredFetch() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<{ ok: true, items: typeof ITEMS }>} */
  const promise = new Promise((r) => {
    resolve = () => r({ ok: true, items: ITEMS });
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  fingerprint = 'F1';
  mock_fingerprint.mockImplementation(() => fingerprint);
  mock_fetch.mockImplementation(async () => ({ ok: true, items: ITEMS }));
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of temp_dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('refresh pass change probe', () => {
  test('skips a pass and logs it when the manifest is unchanged', async () => {
    await setup();

    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);
    expect(log_spy).not.toHaveBeenCalledWith(SKIP_LOG, 'F1');

    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);
    expect(log_spy).toHaveBeenCalledWith(SKIP_LOG, 'F1');
  });

  test('runs the pass after a ws mutation that changed the manifest', async () => {
    await setup();
    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);

    mock_run.mockImplementationOnce(async () => {
      fingerprint = 'F2';
      return { code: 0, stdout: 'UI-1', stderr: '' };
    });
    await handleMessage(
      /** @type {any} */ (makeSocket()),
      Buffer.from(
        JSON.stringify({
          id: 'create1',
          type: /** @type {any} */ ('create-issue'),
          payload: { title: 'X' }
        })
      )
    );
    await vi.advanceTimersByTimeAsync(MUTATION_WINDOW_MS);

    expect(mock_fetch).toHaveBeenCalledTimes(2);
    expect(log_spy).not.toHaveBeenCalledWith(SKIP_LOG, 'F2');
  });

  test('never skips when the workspace has no fingerprint', async () => {
    fingerprint = null;
    await setup();

    await watcherPass();
    await watcherPass();

    expect(mock_fetch).toHaveBeenCalledTimes(2);
  });

  test('runs again when the previous pass had a failed fetch', async () => {
    await setup();
    mock_fetch.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'bd_error', message: 'boom' }
    }));

    await watcherPass();
    await watcherPass();

    expect(mock_fetch).toHaveBeenCalledTimes(2);
  });

  test('runs again when the previous pass left rows unresolved', async () => {
    await setup();
    mock_fetch.mockImplementationOnce(async () => ({
      ok: true,
      items: ITEMS,
      partial: true
    }));

    await watcherPass();
    await watcherPass();

    expect(mock_fetch).toHaveBeenCalledTimes(2);
  });

  test('a workspace change resets the probe', async () => {
    const { setWorkspace } = await setup();
    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);

    const other_root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-probe-'));
    temp_dirs.push(other_root);
    expect(setWorkspace(other_root).changed).toBe(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(mock_fetch).toHaveBeenCalledTimes(2);
    expect(mock_fingerprint).toHaveBeenLastCalledWith(other_root);
  });

  test('a write landing mid-pass makes the next pass run', async () => {
    await setup();
    const first = deferredFetch();
    mock_fetch.mockImplementationOnce(() => first.promise);

    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);

    fingerprint = 'F2';
    await watcherPass();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(mock_fetch).toHaveBeenCalledTimes(2);
    expect(mock_fingerprint).toHaveReturnedWith('F2');
  });
});

describe('refresh pass scheduling', () => {
  test('requests made while a pass runs share one waiting pass', async () => {
    fingerprint = null;
    await setup();
    const first = deferredFetch();
    mock_fetch.mockImplementationOnce(() => first.promise);

    await watcherPass();
    await watcherPass();
    await watcherPass();
    expect(mock_fetch).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(mock_fetch).toHaveBeenCalledTimes(2);
  });

  test('refresh fetches run at background bd priority', async () => {
    /** @type {string[]} */
    const priorities = [];
    mock_fetch.mockImplementation(async () => {
      priorities.push(currentBdPriority());
      return { ok: true, items: ITEMS };
    });
    await setup();
    expect(priorities).toEqual(['interactive']);

    await watcherPass();

    expect(priorities).toEqual(['interactive', 'background']);
  });
});
