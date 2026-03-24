import { describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';
import { createWsClient } from './ws.js';

// Mock WS client that returns custom settings from get-settings
vi.mock('./ws.js', () => {
  /** @type {Record<string, (p: any) => void>} */
  const handlers = {};
  /** @type {Set<(s: 'connecting'|'open'|'closed'|'reconnecting') => void>} */
  const connHandlers = new Set();
  const singleton = {
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    async send(type, payload) {
      void payload;
      if (type === 'get-settings') {
        return {
          settings: {
            board: {
              columns: [
                {
                  id: 'todo',
                  label: 'To Do',
                  subscription: 'todo-issues',
                  drop_status: 'open'
                },
                {
                  id: 'doing',
                  label: 'Doing',
                  subscription: 'doing-issues',
                  drop_status: 'in_progress'
                },
                {
                  id: 'done',
                  label: 'Done',
                  subscription: 'done-issues',
                  drop_status: 'closed'
                }
              ]
            }
          }
        };
      }
      return null;
    },
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {(p:any)=>void} handler
     */
    on(type, handler) {
      handlers[type] = handler;
      return () => {
        delete handlers[type];
      };
    },
    /**
     * @param {import('./protocol.js').MessageType} type
     * @param {any} payload
     */
    _trigger(type, payload) {
      if (handlers[type]) {
        handlers[type](payload);
      }
    },
    /**
     * @param {(s:'connecting'|'open'|'closed'|'reconnecting')=>void} fn
     */
    onConnection(fn) {
      connHandlers.add(fn);
      return () => connHandlers.delete(fn);
    },
    /** @param {'connecting'|'open'|'closed'|'reconnecting'} s */
    _emitConn(s) {
      for (const fn of Array.from(connHandlers)) {
        try {
          fn(s);
        } catch {
          /* ignore */
        }
      }
    },
    close() {},
    getState() {
      return 'open';
    }
  };
  return { createWsClient: () => singleton };
});

describe('settings bootstrap (C1)', () => {
  test('board renders server-configured columns after get-settings resolves', async () => {
    createWsClient();
    window.location.hash = '#/board';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    // Flush microtasks for get-settings promise and route change
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(3);
    });

    // Board should have three columns from server settings, not default four
    const columns = root.querySelectorAll('.board-column');

    // Verify server column IDs are used
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).toContain('todo-col');
    expect(col_ids).toContain('doing-col');
    expect(col_ids).toContain('done-col');

    // Default column IDs should NOT be present
    expect(col_ids).not.toContain('blocked-col');
    expect(col_ids).not.toContain('ready-col');
  });
});

describe('settings-changed with effective settings', () => {
  test('settings-changed with project-override columns rebuilds board', async () => {
    const client = /** @type {any} */ (createWsClient());
    window.location.hash = '#/board';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(3);
    });

    // Simulate server pushing effective settings with project-level column overrides
    client._trigger('settings-changed', {
      settings: {
        board: {
          columns: [
            {
              id: 'proj-backlog',
              label: 'Project Backlog',
              subscription: 'backlog-list',
              drop_status: 'open'
            },
            {
              id: 'proj-active',
              label: 'Project Active',
              subscription: 'active-list',
              drop_status: 'in_progress'
            }
          ]
        }
      }
    });
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(2);
    });

    const col_ids = Array.from(root.querySelectorAll('.board-column')).map(
      (c) => c.id
    );
    expect(col_ids).toContain('proj-backlog-col');
    expect(col_ids).toContain('proj-active-col');
  });

  test('settings-changed falling back to global columns works', async () => {
    const client = /** @type {any} */ (createWsClient());
    window.location.hash = '#/board';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(3);
    });

    // Simulate server pushing effective settings where project has no overrides
    // (global columns sent as-is)
    client._trigger('settings-changed', {
      settings: {
        board: {
          columns: [
            {
              id: 'todo',
              label: 'To Do',
              subscription: 'todo-issues',
              drop_status: 'open'
            },
            {
              id: 'doing',
              label: 'Doing',
              subscription: 'doing-issues',
              drop_status: 'in_progress'
            },
            {
              id: 'done',
              label: 'Done',
              subscription: 'done-issues',
              drop_status: 'closed'
            }
          ]
        }
      }
    });
    // Columns should remain the same (3 columns, same as initial)
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(3);
    });
  });
});

describe('settings-changed hot-reload', () => {
  test('settings hot-reload rebuilds board with new columns', async () => {
    const client = /** @type {any} */ (createWsClient());
    window.location.hash = '#/board';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(3);
    });

    // Hot-reload with 2 columns
    client._trigger('settings-changed', {
      settings: {
        board: {
          columns: [
            {
              id: 'alpha',
              label: 'Alpha',
              subscription: 'alpha-list',
              drop_status: 'open'
            },
            {
              id: 'beta',
              label: 'Beta',
              subscription: 'beta-list',
              drop_status: 'closed'
            }
          ]
        }
      }
    });
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.board-column').length).toBe(2);
    });
  });
});
