import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** @type {Map<string, string>} */
let file_contents;
/** @type {string[]} */
let written_files;

vi.mock('./bd.js', () => ({
  runBd: vi.fn(),
  runBdJson: vi.fn(),
  getGitUserName: vi.fn()
}));

vi.mock('./db.js', () => ({
  resolveWorkspaceDatabase: vi.fn(() => ({ path: '/mock-db' }))
}));

vi.mock('node:os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home'
}));

vi.mock('node:fs', () => {
  /** @param {string} p */
  const readFileSync = vi.fn((p) => {
    if (file_contents.has(p)) {
      return file_contents.get(p);
    }
    const err = /** @type {NodeJS.ErrnoException} */ (
      new Error(`ENOENT: no such file: ${p}`)
    );
    err.code = 'ENOENT';
    throw err;
  });
  const existsSync = vi.fn(
    (p) => file_contents.has(String(p)) || String(p) === '/mock-home/.beads'
  );
  const watch = vi.fn(() => ({ close: vi.fn() }));
  const mkdirSync = vi.fn();
  const writeFileSync = vi.fn((p, content) => {
    file_contents.set(String(p), String(content));
    written_files.push(String(p));
  });
  const renameSync = vi.fn((src, dest) => {
    const content = file_contents.get(String(src));
    if (content !== undefined) {
      file_contents.set(String(dest), content);
      file_contents.delete(String(src));
    }
    written_files.push(String(dest));
  });
  return {
    default: {
      readFileSync,
      existsSync,
      watch,
      mkdirSync,
      writeFileSync,
      renameSync
    },
    readFileSync,
    existsSync,
    watch,
    mkdirSync,
    writeFileSync,
    renameSync
  };
});

beforeEach(() => {
  file_contents = new Map();
  written_files = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeStubSocket() {
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
 * @param {string} type
 * @param {unknown} [payload]
 * @returns {Buffer}
 */
function makeMsg(type, payload) {
  return Buffer.from(
    JSON.stringify({
      id: 'req-1',
      type: /** @type {any} */ (type),
      payload
    })
  );
}

/** Fresh-import ws.js to reset module-level state (CURRENT_WORKSPACE). */
async function freshWsImport() {
  vi.resetModules();
  return import('./ws.js');
}

/**
 * Set up a workspace via set-workspace handler.
 *
 * @param {typeof import('./ws.js').handleMessage} handleMessage
 * @param {ReturnType<typeof makeStubSocket>} ws
 * @param {string} workspace_path
 */
async function setWorkspace(handleMessage, ws, workspace_path) {
  await handleMessage(
    /** @type {any} */ (ws),
    makeMsg('set-workspace', { path: workspace_path })
  );
  ws.sent.length = 0;
}

describe('get-settings handler', () => {
  test('returns effective settings with project override when workspace is active', async () => {
    // Set up global settings
    file_contents.set(
      '/mock-home/.beads/config.json',
      JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
    );
    // Set up project settings with custom columns
    const project_columns = [
      {
        id: 'proj-col',
        label: 'Project',
        subscription: 'ready-issues',
        drop_status: 'open'
      }
    ];
    file_contents.set(
      '/test-workspace/.beads/config.json',
      JSON.stringify({ board: { columns: project_columns } })
    );

    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await setWorkspace(handleMessage, ws, '/test-workspace');

    await handleMessage(/** @type {any} */ (ws), makeMsg('get-settings'));

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(true);
    expect(reply.payload.settings.board.columns[0].id).toBe('proj-col');
  });
});

describe('get-project-settings handler', () => {
  test('returns project settings when workspace has overrides', async () => {
    const project_columns = [
      {
        id: 'custom',
        label: 'Custom',
        subscription: 'ready-issues',
        drop_status: 'open'
      }
    ];
    file_contents.set(
      '/test-workspace/.beads/config.json',
      JSON.stringify({ board: { columns: project_columns } })
    );

    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await setWorkspace(handleMessage, ws, '/test-workspace');

    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('get-project-settings')
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(true);
    expect(reply.payload.settings).not.toBeNull();
    expect(reply.payload.settings.board.columns).toEqual(project_columns);
  });

  test('returns null settings when no project config exists', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await setWorkspace(handleMessage, ws, '/no-config-workspace');

    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('get-project-settings')
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(true);
    expect(reply.payload.settings).toBeNull();
  });
});

describe('save-settings handler', () => {
  test('returns error for invalid scope', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('save-settings', { scope: 'invalid', settings: {} })
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe('invalid_scope');
  });

  test('returns error for invalid columns', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('save-settings', {
        scope: 'global',
        settings: {
          board: {
            columns: [{ id: '', label: '', subscription: '', drop_status: '' }]
          }
        }
      })
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe('invalid_columns');
  });

  test('writes global settings via atomic rename', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('save-settings', {
        scope: 'global',
        settings: {
          board: {
            columns: [
              {
                id: 'col1',
                label: 'Col 1',
                subscription: 'ready-issues',
                drop_status: 'open'
              }
            ]
          }
        }
      })
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(true);
    expect(
      written_files.some((f) => f === '/mock-home/.beads/config.json')
    ).toBe(true);
  });

  test('writes project settings when workspace is active', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await setWorkspace(handleMessage, ws, '/test-workspace');

    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('save-settings', {
        scope: 'project',
        settings: {
          board: {
            columns: [
              {
                id: 'proj',
                label: 'Proj',
                subscription: 'ready-issues',
                drop_status: 'open'
              }
            ]
          }
        }
      })
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(true);
    expect(
      written_files.some((f) => f === '/test-workspace/.beads/config.json')
    ).toBe(true);
  });

  test('returns error when saving project settings with no workspace', async () => {
    const { handleMessage } = await freshWsImport();
    const ws = makeStubSocket();
    await handleMessage(
      /** @type {any} */ (ws),
      makeMsg('save-settings', { scope: 'project', settings: {} })
    );

    expect(ws.sent.length).toBe(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe('no_workspace');
  });
});
