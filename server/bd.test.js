import { spawn as spawnMock } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getBdBin,
  getGitUserName,
  runBd,
  runBdJson,
  runInBackground
} from './bd.js';

// Mock child_process.spawn before importing the module under test
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

/**
 * @param {string} stdoutText
 * @param {string} stderrText
 * @param {number} code
 */
function makeFakeProc(stdoutText, stderrText, code) {
  const cp = /** @type {any} */ (new EventEmitter());
  const out = new PassThrough();
  const err = new PassThrough();
  cp.stdout = out;
  cp.stderr = err;
  // Simulate async emission
  setTimeout(() => {
    if (stdoutText) {
      out.write(stdoutText);
    }
    out.end();
    if (stderrText) {
      err.write(stderrText);
    }
    err.end();
    cp.emit('close', code);
  }, 0);
  return cp;
}

/**
 * Install a spawn mock whose processes exit only when `finish(name)` is
 * called. A job is named by its last argument.
 */
function controlSpawns() {
  /** @type {string[]} */
  const started = [];
  /** @type {Map<string, () => void>} */
  const finishers = new Map();
  /** @type {Array<{ count: number, resolve: () => void }>} */
  const waiters = [];
  mockedSpawn.mockImplementation((_bin, args) => {
    const cp = /** @type {any} */ (new EventEmitter());
    cp.stdout = new PassThrough();
    cp.stderr = new PassThrough();
    const name = String(args[args.length - 1]);
    finishers.set(name, () => {
      cp.stdout.end();
      cp.stderr.end();
      cp.emit('close', 0);
    });
    started.push(name);
    for (const w of waiters.splice(0)) {
      if (started.length >= w.count) {
        w.resolve();
      } else {
        waiters.push(w);
      }
    }
    return cp;
  });
  return {
    started,
    /**
     * @param {number} count
     * @returns {Promise<void>}
     */
    untilStarted(count) {
      if (started.length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },
    /** @param {string} name */
    finish(name) {
      finishers.get(name)?.();
    }
  };
}

const mockedSpawn = /** @type {import('vitest').Mock} */ (spawnMock);
/** @type {string[]} */
const temp_dirs = [];

function make_temp_dir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-bd-'));
  temp_dirs.push(dir);
  return dir;
}

beforeEach(() => {
  mockedSpawn.mockReset();
});

afterEach(() => {
  for (const dir of temp_dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

describe('getBdBin', () => {
  test('returns env BD_BIN when set', () => {
    const prev = process.env.BD_BIN;
    process.env.BD_BIN = '/custom/bd';
    expect(getBdBin()).toBe('/custom/bd');
    if (prev) {
      process.env.BD_BIN = prev;
    } else {
      delete process.env.BD_BIN;
    }
  });
});

describe('runBd', () => {
  test('prepends --sandbox by default', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    await runBd(['list', '--json']);

    const args = mockedSpawn.mock.calls[0][1];
    expect(args[0]).toBe('--sandbox');
    expect(args.slice(1)).toEqual(['list', '--json']);
  });

  test('does not duplicate --sandbox when caller already provides it', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    await runBd(['--sandbox', 'list', '--json']);

    const args = mockedSpawn.mock.calls[0][1];
    expect(args).toEqual(['--sandbox', 'list', '--json']);
  });

  test('allows disabling default sandbox via BDUI_BD_SANDBOX', async () => {
    const prev = process.env.BDUI_BD_SANDBOX;
    process.env.BDUI_BD_SANDBOX = '0';
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));

    await runBd(['list', '--json']);

    const args = mockedSpawn.mock.calls[0][1];
    expect(args).toEqual(['list', '--json']);

    if (prev === undefined) {
      delete process.env.BDUI_BD_SANDBOX;
    } else {
      process.env.BDUI_BD_SANDBOX = prev;
    }
  });

  test('returns stdout/stderr and exit code', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    const res = await runBd(['--version']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('ok');
  });

  test('non-zero exit propagates code and stderr', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('', 'boom', 1));
    const res = await runBd(['list']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('boom');
  });

  test('sets BEADS_DB for workspace-local SQLite db', async () => {
    const root = make_temp_dir();
    const beads_dir = path.join(root, '.beads');
    fs.mkdirSync(beads_dir, { recursive: true });
    const workspace_db = path.join(beads_dir, 'ui.db');
    fs.writeFileSync(workspace_db, '');

    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    await runBd(['list'], { cwd: root, env: {} });

    const options = mockedSpawn.mock.calls[0][2];
    expect(options.env.BEADS_DB).toBe(workspace_db);
  });

  test('does not force BEADS_DB when workspace has no local SQLite db', async () => {
    const root = make_temp_dir();

    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    await runBd(['list'], { cwd: root, env: {} });

    const options = mockedSpawn.mock.calls[0][2];
    expect(options.env.BEADS_DB).toBeUndefined();
  });

  test('preserves explicit BEADS_DB from caller env', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));
    await runBd(['list'], { env: { BEADS_DB: '/custom/workspace.db' } });

    const options = mockedSpawn.mock.calls[0][2];
    expect(options.env.BEADS_DB).toBe('/custom/workspace.db');
  });
});

describe('bd run queue priority', () => {
  test('queued interactive calls run before queued background calls', async () => {
    const spawns = controlSpawns();
    const running = runInBackground(() => runBd(['bg-running']));
    await spawns.untilStarted(1);

    const bg_first = runInBackground(() => runBd(['bg-first']));
    const fg_first = runBd(['fg-first']);
    const bg_second = runInBackground(() => runBd(['bg-second']));
    const fg_second = runBd(['fg-second']);

    // A running job is never interrupted by a queued interactive one
    await Promise.resolve();
    expect(spawns.started).toEqual(['bg-running']);

    // Finish whichever job holds the slot until all five have run
    const total = 5;
    for (let count = 1; count < total; count++) {
      spawns.finish(spawns.started[count - 1]);
      await spawns.untilStarted(count + 1);
    }
    spawns.finish(spawns.started[total - 1]);
    await Promise.all([running, bg_first, fg_first, bg_second, fg_second]);

    expect(spawns.started).toEqual([
      'bg-running',
      'fg-first',
      'fg-second',
      'bg-first',
      'bg-second'
    ]);
  });

  test('background priority survives awaits inside runInBackground', async () => {
    const spawns = controlSpawns();
    const running = runBd(['fg-running']);
    await spawns.untilStarted(1);

    const bg = runInBackground(async () => {
      await Promise.resolve();
      return runBd(['bg-after-await']);
    });
    await Promise.resolve();
    const fg = runBd(['fg-later']);

    spawns.finish('fg-running');
    await spawns.untilStarted(2);
    spawns.finish(spawns.started[1]);
    await spawns.untilStarted(3);
    spawns.finish(spawns.started[2]);
    await Promise.all([running, bg, fg]);

    expect(spawns.started).toEqual([
      'fg-running',
      'fg-later',
      'bg-after-await'
    ]);
  });

  test('a failing job releases the queue for the next one', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('', 'boom', 1));
    mockedSpawn.mockReturnValueOnce(makeFakeProc('ok', '', 0));

    const [failed, next] = await Promise.all([
      runBd(['list']),
      runInBackground(() => runBd(['list']))
    ]);

    expect(failed.code).toBe(1);
    expect(next.code).toBe(0);
  });
});

describe('runBdJson', () => {
  test('parses valid JSON output', async () => {
    const json = JSON.stringify([{ id: 'UI-1' }]);
    mockedSpawn.mockReturnValueOnce(makeFakeProc(json, '', 0));
    const res = await runBdJson(['list', '--json']);
    expect(res.code).toBe(0);
    expect(Array.isArray(res.stdoutJson)).toBe(true);
  });

  test('invalid JSON yields stderr message with code 0', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('not-json', '', 0));
    const res = await runBdJson(['list', '--json']);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain('Invalid JSON');
  });

  test('non-zero exit returns code and stderr', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('', 'oops', 2));
    const res = await runBdJson(['list', '--json']);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('oops');
  });
});

describe('getGitUserName', () => {
  test('returns git user name on success', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('Alice Smith\n', '', 0));
    const name = await getGitUserName();
    expect(name).toBe('Alice Smith');
  });

  test('returns empty string on failure', async () => {
    mockedSpawn.mockReturnValueOnce(makeFakeProc('', 'error', 1));
    const name = await getGitUserName();
    expect(name).toBe('');
  });
});
