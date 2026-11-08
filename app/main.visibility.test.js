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
  return { calls, handlers };
});

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type
     * @param {any} payload
     */
    async send(type, payload) {
      ws.calls.push({ type, payload });
      return null;
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

/** Mirrors the grace period in main.js. */
const HIDDEN_PAUSE_GRACE_MS = 30000;
/** A step inside the grace period. */
const WITHIN_GRACE_MS = HIDDEN_PAUSE_GRACE_MS - 1000;
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

/** @param {'subscribe-list' | 'unsubscribe-list'} type */
function sentIds(type) {
  return ws.calls
    .filter((c) => c.type === type)
    .map((c) => String(c.payload?.id));
}

/** @param {DocumentVisibilityState} state */
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** @param {string} hash */
function boot(hash) {
  window.location.hash = hash;
  document.body.innerHTML = '<main id="app"></main>';
  bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
}

/** @type {ReturnType<typeof vi.spyOn>} */
let window_listeners;
/** @type {ReturnType<typeof vi.spyOn>} */
let document_listeners;

beforeEach(() => {
  vi.useFakeTimers();
  ws.calls.length = 0;
  for (const key of Object.keys(ws.handlers)) {
    delete ws.handlers[key];
  }
  window.localStorage.clear();
  // Track listeners so each test's app instance can be detached
  window_listeners = vi.spyOn(window, 'addEventListener');
  document_listeners = vi.spyOn(document, 'addEventListener');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible'
  });
});

afterEach(() => {
  for (const [type, listener] of window_listeners.mock.calls) {
    window.removeEventListener(type, listener);
  }
  for (const [type, listener] of document_listeners.mock.calls) {
    document.removeEventListener(type, listener);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('hidden tab pause', () => {
  test('hidden past the grace unsubscribes every board subscription', async () => {
    boot('#/board');
    await flush();
    const subscribed = sentIds('subscribe-list');
    expect(subscribed).toContain('tab:board-index');
    expect(subscribed.some((id) => id.startsWith('tab:board:'))).toBe(true);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HIDDEN_PAUSE_GRACE_MS);
    await flush();

    expect(sentIds('unsubscribe-list').sort()).toEqual(subscribed.sort());
  });

  test('hidden past the grace unsubscribes the graph', async () => {
    boot('#/graph');
    await flush();
    expect(sent('subscribe-list', 'tab:graph')).toHaveLength(1);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HIDDEN_PAUSE_GRACE_MS);
    await flush();

    expect(sent('unsubscribe-list', 'tab:graph')).toHaveLength(1);
  });

  test('hidden then visible within the grace does nothing', async () => {
    boot('#/issues');
    await flush();
    const calls_before = ws.calls.length;

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(WITHIN_GRACE_MS);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(HIDDEN_PAUSE_GRACE_MS);
    await flush();

    expect(sentIds('unsubscribe-list')).toEqual([]);
    expect(ws.calls.length).toBe(calls_before);
  });

  test('visible after a pause resubscribes once', async () => {
    boot('#/issues');
    await flush();
    expect(sent('subscribe-list', 'tab:issues')).toHaveLength(1);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HIDDEN_PAUSE_GRACE_MS);
    await flush();
    expect(sent('unsubscribe-list', 'tab:issues')).toHaveLength(1);

    setVisibility('visible');
    await flush();
    // A repeated visible event must not subscribe a second time
    setVisibility('visible');
    await flush();

    expect(sent('subscribe-list', 'tab:issues')).toHaveLength(2);
  });

  test('navigating while paused does not subscribe until visible', async () => {
    boot('#/issues');
    await flush();

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(HIDDEN_PAUSE_GRACE_MS);
    await flush();

    window.location.hash = '#/epics';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(sent('subscribe-list', 'tab:epics')).toHaveLength(0);

    setVisibility('visible');
    await flush();
    expect(sent('subscribe-list', 'tab:epics')).toHaveLength(1);
  });
});
