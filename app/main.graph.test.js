import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

// Provide a minimal dialog polyfill for jsdom environments
if (typeof HTMLDialogElement !== 'undefined') {
  const proto = /** @type {any} */ (HTMLDialogElement.prototype);
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    proto.close = function close() {
      this.removeAttribute('open');
    };
  }
}

const ws = vi.hoisted(() => {
  /** @type {Array<{ type: string, payload: any }>} */
  const calls = [];
  /** @type {Record<string, (p: any) => void>} */
  const handlers = {};
  /** @type {{ current: (type: string, payload: any) => Promise<unknown> }} */
  const responder = { current: async () => null };
  return { calls, handlers, responder };
});

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type
     * @param {any} payload
     */
    async send(type, payload) {
      ws.calls.push({ type, payload });
      return ws.responder.current(type, payload);
    },
    /**
     * @param {string} type
     * @param {(p: any) => void} handler
     */
    on(type, handler) {
      ws.handlers[type] = handler;
      return () => {};
    },
    close() {},
    getState() {
      return 'open';
    }
  })
}));

/** Enough microtask turns for a send, its reply and the follow-up send. */
const MICROTASK_ROUNDS = 20;

async function flush() {
  for (let i = 0; i < MICROTASK_ROUNDS; i++) {
    await Promise.resolve();
  }
}

/**
 * @param {'subscribe-list' | 'unsubscribe-list'} type
 * @param {string} id
 */
function sent(type, id) {
  return ws.calls.filter((c) => c.type === type && c.payload?.id === id);
}

/** @param {string} hash */
function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * A promise with its resolver exposed.
 *
 * @returns {{ promise: Promise<unknown>, resolve: (v: unknown) => void }}
 */
function deferred() {
  /** @type {(v: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** @param {string} id */
function root(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

const FOCUS_ISSUE = {
  id: 'UI-1',
  title: 'Focus bead',
  status: 'open',
  priority: 1,
  issue_type: 'task',
  dependencies: [],
  dependents: []
};

/** @param {number} revision */
function pushGraphSnapshot(revision) {
  ws.handlers.snapshot({
    type: 'snapshot',
    id: 'tab:graph',
    revision,
    issues: [FOCUS_ISSUE]
  });
}

/** @type {ReturnType<typeof vi.spyOn>} */
let window_listeners;

beforeEach(() => {
  ws.calls.length = 0;
  for (const key of Object.keys(ws.handlers)) {
    delete ws.handlers[key];
  }
  ws.responder.current = async () => null;
  window.localStorage.clear();
  // Track window listeners so each test's app instance can be detached
  window_listeners = vi.spyOn(window, 'addEventListener');
});

afterEach(() => {
  for (const [type, listener] of window_listeners.mock.calls) {
    window.removeEventListener(type, listener);
  }
  vi.restoreAllMocks();
});

/** @param {string} hash */
function boot(hash) {
  window.location.hash = hash;
  document.body.innerHTML = '<main id="app"></main>';
  bootstrap(root('app'));
}

describe('graph tab wiring', () => {
  test('deep link shows the graph behind the dialog and subscribes', async () => {
    boot('#/graph?focus=UI-1&issue=UI-2');

    expect(root('graph-root').hidden).toBe(false);
    expect(root('issues-root').hidden).toBe(true);
    expect(root('board-root').hidden).toBe(true);
    expect(root('issue-dialog-title').textContent).toBe('UI-2');
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);
    });
    expect(sent('subscribe-list', 'tab:graph')[0].payload.type).toBe(
      'graph-issues'
    );

    pushGraphSnapshot(1);
    await vi.waitFor(() => {
      expect(root('graph-root').textContent).toContain('Focus bead');
    });
  });

  test('entering and leaving views sends the matching messages', async () => {
    boot('#/graph');
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);
    });

    navigate('#/board');
    await vi.waitFor(() => {
      expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(1);
      expect(sent('subscribe-list', 'tab:board-index')).toHaveLength(1);
    });
    // Board and graph share the server key under distinct client ids
    expect(sent('subscribe-list', 'tab:board-index')[0].payload.type).toBe(
      'graph-issues'
    );

    navigate('#/issues');
    await vi.waitFor(() => {
      expect(sent('unsubscribe-list', 'tab:board-index')).toHaveLength(1);
    });
    expect(root('graph-root').hidden).toBe(true);
  });

  test('closing the dialog returns to the graph focus', async () => {
    boot('#/graph?focus=UI-1&issue=UI-2');
    await flush();

    const dlg = root('issue-dialog');
    const close = /** @type {HTMLButtonElement} */ (
      dlg.querySelector('.issue-dialog__close')
    );
    close.click();
    await flush();

    expect(dlg.hasAttribute('open')).toBe(false);
    expect(window.location.hash).toBe('#/graph?focus=UI-1');
  });

  test('the focus survives the saved-workspace restore', async () => {
    window.localStorage.setItem('beads-ui.workspace', '/work/b');
    ws.responder.current = async (type) => {
      if (type === 'list-workspaces') {
        return {
          workspaces: [{ path: '/work/a' }, { path: '/work/b' }],
          current: { root_dir: '/work/a', db_path: '/work/a/db' }
        };
      }
      if (type === 'set-workspace') {
        return {
          workspace: { root_dir: '/work/b', db_path: '/work/b/db' },
          changed: true
        };
      }
      return null;
    };
    boot('#/graph?focus=UI-1');

    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:graph')).toHaveLength(2);
    });
    expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(1);
    expect(window.location.hash).toBe('#/graph?focus=UI-1');

    pushGraphSnapshot(1);
    await vi.waitFor(() => {
      expect(root('graph-root').textContent).toContain('Focus bead');
    });
  });

  test('a subscribe reply after leaving the graph unsubscribes at once', async () => {
    const reply = deferred();
    ws.responder.current = async (type, payload) =>
      type === 'subscribe-list' && payload.id === 'tab:graph'
        ? reply.promise
        : null;
    boot('#/graph');
    await flush();

    navigate('#/issues');
    await flush();
    expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(0);

    reply.resolve(null);
    await vi.waitFor(() => {
      expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(1);
    });
    await flush();
    expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);
  });

  test('a stale reply after returning to the graph resubscribes', async () => {
    const reply = deferred();
    let first = true;
    ws.responder.current = async (type, payload) => {
      if (type === 'subscribe-list' && payload.id === 'tab:graph' && first) {
        first = false;
        return reply.promise;
      }
      return null;
    };
    boot('#/graph?focus=UI-1');
    await flush();
    navigate('#/issues');
    await flush();
    navigate('#/graph?focus=UI-1');
    await flush();
    // The first request is still in flight, so no duplicate yet
    expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);

    reply.resolve(null);
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:graph')).toHaveLength(2);
    });
    expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(1);

    pushGraphSnapshot(1);
    await vi.waitFor(() => {
      expect(root('graph-root').textContent).toContain('Focus bead');
    });
  });

  test('a graph subscribe failure shows the error and Retry resubscribes', async () => {
    let fail = true;
    ws.responder.current = async (type, payload) => {
      if (type === 'subscribe-list' && payload.id === 'tab:graph' && fail) {
        fail = false;
        throw { code: 'bd_error', message: 'graph down' };
      }
      return null;
    };
    boot('#/graph?focus=UI-1');

    await vi.waitFor(() => {
      expect(root('graph-root').textContent).toContain('graph down');
    });
    // A later state change on the graph does not retry on its own
    navigate('#/graph?focus=UI-1&issue=UI-1');
    await flush();
    expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);

    const retry = /** @type {HTMLButtonElement} */ (
      root('graph-root').querySelector('.graph-retry')
    );
    retry.click();
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:graph')).toHaveLength(2);
    });
    pushGraphSnapshot(1);
    await vi.waitFor(() => {
      expect(root('graph-root').textContent).toContain('Focus bead');
    });
  });

  test('a board-index failure is attempted once per route entry', async () => {
    ws.responder.current = async (type, payload) => {
      if (type === 'subscribe-list' && payload.id === 'tab:board-index') {
        throw { code: 'bd_error', message: 'index down' };
      }
      return null;
    };
    boot('#/board');
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:board-index')).toHaveLength(1);
    });

    // Further passes on the board (a dialog opening and closing) do not retry
    navigate('#/board?issue=UI-1');
    await flush();
    navigate('#/board');
    await flush();
    expect(sent('subscribe-list', 'tab:board-index')).toHaveLength(1);
    expect(root('fatal-error-dialog').hasAttribute('open')).toBe(false);

    navigate('#/issues');
    await flush();
    navigate('#/board');
    await vi.waitFor(() => {
      expect(sent('subscribe-list', 'tab:board-index')).toHaveLength(2);
    });
  });
});

describe('board rebuild', () => {
  /** @param {string[]} ids */
  function columns(ids) {
    return ids.map((id) => ({
      id,
      label: id,
      subscription: `${id}-issues`,
      drop_status: 'open'
    }));
  }

  test('rebuilding the board twice leaves one live keydown handler', async () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    ws.responder.current = async (type) =>
      type === 'get-settings'
        ? { settings: { board: { columns: columns(['todo', 'done']) } } }
        : null;
    boot('#/board');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.board-column')).toHaveLength(2);
    });

    ws.handlers['settings-changed']({
      settings: { board: { columns: columns(['alpha', 'beta', 'gamma']) } }
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.board-column')).toHaveLength(3);
    });

    /**
     * Keydown listeners registered on any board section, live or replaced.
     *
     * @param {typeof add} spy
     * @returns {Array<{ target: HTMLElement, listener: unknown }>}
     */
    const boardKeydown = (spy) => {
      /** @type {Array<{ target: HTMLElement, listener: unknown }>} */
      const out = [];
      spy.mock.calls.forEach((call, i) => {
        const target = spy.mock.contexts[i];
        if (
          call[0] === 'keydown' &&
          target instanceof HTMLElement &&
          target.id === 'board-root'
        ) {
          out.push({ target, listener: call[1] });
        }
      });
      return out;
    };
    const added = boardKeydown(add);
    const removed = boardKeydown(remove);
    expect(added).toHaveLength(3);
    const live = added.filter(
      (a) =>
        !removed.some((r) => r.target === a.target && r.listener === a.listener)
    );
    expect(live).toHaveLength(1);
    expect(live[0].target).toBe(root('board-root'));
  });
});
