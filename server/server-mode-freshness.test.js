import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runBdJson } from './bd.js';
import { DOLT_JOURNAL_NAME } from './dolt-manifest.js';
import { fetchListForSubscription } from './list-adapters.js';

vi.mock('./bd.js', () => ({ runBdJson: vi.fn() }));

const runBdJsonMock = /** @type {import('vitest').Mock} */ (runBdJson);

/** @type {string[]} */
const tmps = [];

/**
 * A workspace that switched to a Dolt server: metadata.json names the server
 * and the embedded manifest it left behind never changes again.
 */
function mkServerWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-server-'));
  tmps.push(root);
  const beads = path.join(root, '.beads');
  const noms = path.join(beads, 'embeddeddolt', 'ws', '.dolt', 'noms');
  fs.mkdirSync(noms, { recursive: true });
  fs.writeFileSync(path.join(noms, 'manifest'), 'frozen-before-switch');
  fs.writeFileSync(
    path.join(beads, 'metadata.json'),
    JSON.stringify({
      backend: 'dolt',
      dolt_mode: 'server',
      dolt_server_host: '127.0.0.1',
      dolt_server_port: 3417,
      dolt_database: 'ws'
    })
  );
  return root;
}

/**
 * Answer `bd list` with the rows `rows()` returns at call time.
 *
 * @param {() => Array<Record<string, unknown>>} rows
 */
function answerList(rows) {
  runBdJsonMock.mockImplementation(async (/** @type {string[]} */ args) =>
    args[0] === 'list'
      ? { code: 0, stdoutJson: rows() }
      : { code: 1, stderr: 'unexpected' }
  );
}

/**
 * Number of `bd list` spawns so far.
 */
function listSpawns() {
  return runBdJsonMock.mock.calls.filter((call) => call[0][0] === 'list')
    .length;
}

/** A time well outside the journal settle window. */
const SETTLED = new Date(Date.UTC(2026, 0, 1));

/**
 * Point `BDUI_DOLT_DATA_DIR` at a data dir holding database `ws` and return
 * its settled journal path.
 */
function mkDataDir() {
  const data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-data-'));
  tmps.push(data_dir);
  fs.mkdirSync(path.join(data_dir, '.dolt'));
  fs.writeFileSync(
    path.join(data_dir, '.dolt', 'sql-server.info'),
    '4242:3417:cadcc1b5-74d4-4244-8a28-a3133188b64e'
  );
  const noms = path.join(data_dir, 'ws', '.dolt', 'noms');
  fs.mkdirSync(noms, { recursive: true });
  fs.writeFileSync(path.join(noms, 'manifest'), 'server-root');
  const journal = path.join(noms, DOLT_JOURNAL_NAME);
  fs.writeFileSync(journal, 'chunk-1');
  fs.utimesSync(journal, SETTLED, SETTLED);
  vi.stubEnv('BDUI_DOLT_DATA_DIR', data_dir);
  return journal;
}

/** @param {{ ok: boolean, items?: Array<{ id: string }> }} res */
function ids(res) {
  return res.ok ? (res.items ?? []).map((it) => it.id) : [];
}

beforeEach(() => {
  runBdJsonMock.mockReset();
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('BEADS_DOLT_') || name.startsWith('BDUI_DOLT_')) {
      vi.stubEnv(name, '');
    }
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-data-'));
  tmps.push(empty);
  vi.stubEnv('BDUI_DOLT_DATA_DIR', empty);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('a workspace on a Dolt server', () => {
  test('drops a bead bd now reports closed on the next fetch', async () => {
    const cwd = mkServerWorkspace();
    let rows = [
      { id: 'W-1', status: 'in_progress', title: 'Epic' },
      { id: 'W-2', status: 'in_progress', title: 'Task' }
    ];
    answerList(() => rows);

    const first = await fetchListForSubscription(
      { type: 'in-progress-issues' },
      { cwd }
    );
    expect(ids(first)).toEqual(['W-1', 'W-2']);

    rows = [{ id: 'W-1', status: 'in_progress', title: 'Epic' }];
    const second = await fetchListForSubscription(
      { type: 'in-progress-issues' },
      { cwd }
    );
    expect(ids(second)).toEqual(['W-1']);
  });

  test('reuses the rows until a write moves the server journal', async () => {
    const journal = mkDataDir();
    const cwd = mkServerWorkspace();
    let rows = [
      { id: 'W-1', status: 'in_progress', title: 'Epic' },
      { id: 'W-2', status: 'in_progress', title: 'Task' }
    ];
    answerList(() => rows);
    const spec = { type: 'in-progress-issues' };

    await fetchListForSubscription(spec, { cwd });
    await fetchListForSubscription(spec, { cwd });
    expect(listSpawns()).toBe(1);

    rows = [{ id: 'W-1', status: 'in_progress', title: 'Epic' }];
    fs.appendFileSync(journal, 'chunk-2');
    fs.utimesSync(journal, SETTLED, SETTLED);
    const after = await fetchListForSubscription(spec, { cwd });
    expect(listSpawns()).toBe(2);
    expect(ids(after)).toEqual(['W-1']);
  });
});
