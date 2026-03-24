import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { computeColMinWidth, createBoardView } from './board.js';

function createTestIssueStores() {
  /** @type {Map<string, any>} */
  const stores = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /**
   * @param {string} id
   * @returns {any}
   */
  function getStore(id) {
    let s = stores.get(id);
    if (!s) {
      s = createSubscriptionIssueStore(id);
      stores.set(id, s);
      s.subscribe(() => {
        for (const fn of Array.from(listeners)) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
      });
    }
    return s;
  }
  return {
    getStore,
    /** @param {string} id */
    snapshotFor(id) {
      return getStore(id).snapshot().slice();
    },
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

describe('computeColMinWidth', () => {
  const gap = 16;
  const padding = 12;

  test('5 columns on 1920px viewport', () => {
    const result = computeColMinWidth(1920, 5, gap, padding);
    expect(result).toBe(366);
  });

  test('8 columns on 1920px viewport', () => {
    const result = computeColMinWidth(1920, 8, gap, padding);
    expect(result).toBe(223);
  });

  test('10 columns on 1920px viewport hits 180px floor', () => {
    const result = computeColMinWidth(1920, 10, gap, padding);
    expect(result).toBe(180);
  });

  test('12 columns on 1920px viewport hits 180px floor', () => {
    const result = computeColMinWidth(1920, 12, gap, padding);
    expect(result).toBe(180);
  });

  test('1 column returns full available width', () => {
    const result = computeColMinWidth(1920, 1, gap, padding);
    expect(result).toBe(1896);
  });

  test('0 columns returns viewportWidth', () => {
    const result = computeColMinWidth(1920, 0, gap, padding);
    expect(result).toBe(1920);
  });

  test('negative column count returns viewportWidth', () => {
    const result = computeColMinWidth(1920, -1, gap, padding);
    expect(result).toBe(1920);
  });
});

describe('ResizeObserver integration', () => {
  /** @type {((entries: any[]) => void)|null} */
  let resizeCallback = null;
  /** @type {{ observe: any, unobserve: any, disconnect: any }} */
  let mockObserverInstance;

  beforeEach(() => {
    resizeCallback = null;
    mockObserverInstance = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };
    const MockResizeObserver = class {
      /** @param {(entries: any[]) => void} cb */
      constructor(cb) {
        resizeCallback = cb;
        this.observe = mockObserverInstance.observe;
        this.unobserve = mockObserverInstance.unobserve;
        this.disconnect = mockObserverInstance.disconnect;
      }
    };
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Create a board with some test issues and load it.
   * @param {HTMLElement} mount
   */
  async function createAndLoadBoard(mount) {
    const now = Date.now();
    const issues = [
      {
        id: 'R-1',
        title: 'ready1',
        priority: 0,
        created_at: now,
        updated_at: now,
        issue_type: 'task'
      }
    ];
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues
    });
    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();
    return view;
  }

  test('ResizeObserver is registered when board loads', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    await createAndLoadBoard(mount);

    expect(resizeCallback).not.toBeNull();
    expect(mockObserverInstance.observe).toHaveBeenCalledWith(mount);
  });

  test('ResizeObserver is disconnected when board clear() is called', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const view = await createAndLoadBoard(mount);

    view.clear();
    expect(mockObserverInstance.disconnect).toHaveBeenCalledOnce();
  });

  test('cards get board-card--condensed class when column width < 260px', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    await createAndLoadBoard(mount);

    // Mock column getBoundingClientRect to return 250px width
    const columns = mount.querySelectorAll('.board-column');
    for (const col of Array.from(columns)) {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 250, height: 400, x: 0, y: 0, top: 0, right: 250, bottom: 400, left: 0 })
      );
    }
    // Also mock the board root for the resize handler
    const boardRoot = mount.querySelector('.board-root');
    if (boardRoot) {
      vi.spyOn(boardRoot, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 1000, height: 600, x: 0, y: 0, top: 0, right: 1000, bottom: 600, left: 0 })
      );
    }

    // Trigger resize callback and advance timers
    vi.useFakeTimers();
    if (resizeCallback) {
      resizeCallback([]);
    }
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    const cards = mount.querySelectorAll('.board-card');
    for (const card of Array.from(cards)) {
      expect(card.classList.contains('board-card--condensed')).toBe(true);
      expect(card.classList.contains('board-card--minimal')).toBe(false);
    }
  });

  test('cards get board-card--minimal class when column width < 180px', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    await createAndLoadBoard(mount);

    const columns = mount.querySelectorAll('.board-column');
    for (const col of Array.from(columns)) {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 150, height: 400, x: 0, y: 0, top: 0, right: 150, bottom: 400, left: 0 })
      );
    }
    const boardRoot = mount.querySelector('.board-root');
    if (boardRoot) {
      vi.spyOn(boardRoot, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 600, height: 600, x: 0, y: 0, top: 0, right: 600, bottom: 600, left: 0 })
      );
    }

    vi.useFakeTimers();
    if (resizeCallback) {
      resizeCallback([]);
    }
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    const cards = mount.querySelectorAll('.board-card');
    for (const card of Array.from(cards)) {
      expect(card.classList.contains('board-card--minimal')).toBe(true);
      expect(card.classList.contains('board-card--condensed')).toBe(false);
    }
  });

  test('both classes removed when column width >= 260px', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    await createAndLoadBoard(mount);

    const columns = mount.querySelectorAll('.board-column');
    for (const col of Array.from(columns)) {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 300, height: 400, x: 0, y: 0, top: 0, right: 300, bottom: 400, left: 0 })
      );
    }
    const boardRoot = mount.querySelector('.board-root');
    if (boardRoot) {
      vi.spyOn(boardRoot, 'getBoundingClientRect').mockReturnValue(
        /** @type {any} */ ({ width: 1200, height: 600, x: 0, y: 0, top: 0, right: 1200, bottom: 600, left: 0 })
      );
    }

    vi.useFakeTimers();
    if (resizeCallback) {
      resizeCallback([]);
    }
    vi.advanceTimersByTime(150);
    vi.useRealTimers();

    const cards = mount.querySelectorAll('.board-card');
    for (const card of Array.from(cards)) {
      expect(card.classList.contains('board-card--condensed')).toBe(false);
      expect(card.classList.contains('board-card--minimal')).toBe(false);
    }
  });
});
