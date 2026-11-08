import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetBdVersion } from './bd-version.js';
import { attachWsServer, handleMessage } from './ws.js';

vi.mock('./bd-version.js', () => ({ resetBdVersion: vi.fn() }));
vi.mock('./list-adapters.js', () => ({ fetchListForSubscription: vi.fn() }));

const mock_reset = /** @type {import('vitest').Mock} */ (resetBdVersion);

/** @type {string[]} */
const temp_dirs = [];

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-bind-'));
  temp_dirs.push(dir);
  return dir;
}

beforeEach(() => {
  mock_reset.mockReset();
});

afterEach(() => {
  for (const dir of temp_dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace bind resets the bd version', () => {
  test('on attach, setWorkspace and set-workspace', async () => {
    const initial_root = makeTempRoot();
    const { setWorkspace } = attachWsServer(createServer(), {
      path: '/ws',
      root_dir: initial_root
    });
    expect(mock_reset).toHaveBeenLastCalledWith(initial_root);

    const switched_root = makeTempRoot();
    setWorkspace(switched_root);
    expect(mock_reset).toHaveBeenLastCalledWith(path.resolve(switched_root));

    const requested_root = makeTempRoot();
    const sock = { sent: [], readyState: 1, OPEN: 1, send() {} };
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'ws-1',
          type: /** @type {any} */ ('set-workspace'),
          payload: { path: requested_root }
        })
      )
    );
    expect(mock_reset).toHaveBeenLastCalledWith(path.resolve(requested_root));
    expect(mock_reset).toHaveBeenCalledTimes(3);
  });
});
