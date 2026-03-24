import { afterEach, describe, expect, test } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createBoardView } from './board.js';

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

/**
 * Create a mock store with workspace path for localStorage key generation.
 *
 * @param {string} [workspace_path]
 * @returns {any}
 */
function createMockStore(workspace_path = '/test/project') {
  /** @type {any} */
  const store = {
    state: {
      selected_id: null,
      view: 'board',
      filters: { status: 'all', search: '', type: '' },
      board: { closed_filter: 'today', board_filters: {} },
      workspace: {
        current: { path: workspace_path },
        available: [{ path: workspace_path }]
      }
    },
    subs: [],
    getState() {
      return this.state;
    },
    /** @param {any} patch */
    setState(patch) {
      this.state = {
        ...this.state,
        ...(patch || {}),
        filters: { ...this.state.filters, ...(patch.filters || {}) },
        board: { ...this.state.board, ...(patch.board || {}) },
        workspace: {
          ...this.state.workspace,
          ...(patch.workspace || {})
        }
      };
      for (const fn of this.subs) {
        fn(this.state);
      }
    },
    /** @param {(s: any) => void} fn */
    subscribe(fn) {
      this.subs.push(fn);
      return () => {
        this.subs = this.subs.filter((/** @type {any} */ f) => f !== fn);
      };
    }
  };
  return store;
}

/**
 * Seed issue stores with one issue per default column for a board.
 *
 * @param {ReturnType<typeof createTestIssueStores>} issueStores
 */
function seedDefaultColumns(issueStores) {
  const now = Date.now();
  issueStores.getStore('tab:board:blocked').applyPush({
    type: 'snapshot',
    id: 'tab:board:blocked',
    revision: 1,
    issues: [{ id: 'BLK-1', title: 'blocked', priority: 0, created_at: now }]
  });
  issueStores.getStore('tab:board:ready').applyPush({
    type: 'snapshot',
    id: 'tab:board:ready',
    revision: 1,
    issues: [{ id: 'RDY-1', title: 'ready', priority: 0, created_at: now }]
  });
  issueStores.getStore('tab:board:in-progress').applyPush({
    type: 'snapshot',
    id: 'tab:board:in-progress',
    revision: 1,
    issues: [{ id: 'IP-1', title: 'in progress', priority: 0, created_at: now }]
  });
  issueStores.getStore('tab:board:closed').applyPush({
    type: 'snapshot',
    id: 'tab:board:closed',
    revision: 1,
    issues: [{ id: 'CLS-1', title: 'closed', closed_at: now }]
  });
}

afterEach(() => {
  localStorage.clear();
});

describe('views/board column visibility', () => {
  test('default: all columns visible, dropdown shows N/N count', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore(),
      issueStores
    });
    await view.load();

    // All 4 columns visible
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(4);

    // Dropdown trigger shows 4/4
    const trigger = mount.querySelector(
      '.board-filter-bar .filter-dropdown__trigger'
    );
    expect(trigger?.textContent).toContain('4/4');
  });

  test('toggle off: unchecked column removed from DOM grid', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore(),
      issueStores
    });
    await view.load();

    // Uncheck "Blocked" column (first checkbox in dropdown)
    const checkboxes = mount.querySelectorAll(
      '.board-filter-bar .filter-dropdown__option input[type="checkbox"]'
    );
    expect(checkboxes.length).toBe(4);
    /** @type {HTMLInputElement} */ (checkboxes[0]).click();

    // Now only 3 columns
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(3);

    // The blocked column is gone
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).not.toContain('blocked-col');

    // Dropdown trigger shows 3/4
    const trigger = mount.querySelector(
      '.board-filter-bar .filter-dropdown__trigger'
    );
    expect(trigger?.textContent).toContain('3/4');
  });

  test('toggle on: re-checked column reappears in grid', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore(),
      issueStores
    });
    await view.load();

    // Toggle off then on
    const getCheckboxes = () =>
      mount.querySelectorAll(
        '.board-filter-bar .filter-dropdown__option input[type="checkbox"]'
      );
    /** @type {HTMLInputElement} */ (getCheckboxes()[0]).click();
    expect(mount.querySelectorAll('.board-column').length).toBe(3);

    /** @type {HTMLInputElement} */ (getCheckboxes()[0]).click();
    expect(mount.querySelectorAll('.board-column').length).toBe(4);
  });

  test('--board-columns CSS variable updates to visible count', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore(),
      issueStores
    });
    await view.load();

    const boardRoot = mount.querySelector('.board-root');
    const style = boardRoot?.getAttribute('style') || '';
    expect(style).toContain('--board-columns: 4');

    // Toggle off one column
    const checkboxes = mount.querySelectorAll(
      '.board-filter-bar .filter-dropdown__option input[type="checkbox"]'
    );
    /** @type {HTMLInputElement} */ (checkboxes[0]).click();

    const style2 =
      mount.querySelector('.board-root')?.getAttribute('style') || '';
    expect(style2).toContain('--board-columns: 3');
  });

  test('dropdown renders with correct column labels', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore(),
      issueStores
    });
    await view.load();

    const labels = Array.from(
      mount.querySelectorAll('.board-filter-bar .filter-dropdown__option')
    ).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Blocked', 'Ready', 'In Progress', 'Closed']);
  });
});

describe('views/board column visibility localStorage persistence', () => {
  test('toggle persists to localStorage with correct key', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const store = createMockStore('/my/workspace');
    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Toggle off "Ready" (second checkbox)
    const checkboxes = mount.querySelectorAll(
      '.board-filter-bar .filter-dropdown__option input[type="checkbox"]'
    );
    /** @type {HTMLInputElement} */ (checkboxes[1]).click();

    const stored = localStorage.getItem('beads-ui.board-col-vis:/my/workspace');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(/** @type {string} */ (stored));
    expect(parsed.ready).toBe(false);
    expect(parsed.blocked).toBe(true);
  });

  test('load reads from localStorage and applies state', async () => {
    // Pre-seed localStorage
    localStorage.setItem(
      'beads-ui.board-col-vis:/test/project',
      JSON.stringify({
        blocked: true,
        ready: false,
        'in-progress': true,
        closed: true
      })
    );

    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore('/test/project'),
      issueStores
    });
    await view.load();

    // "Ready" should be hidden
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(3);
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).not.toContain('ready-col');

    // Dropdown trigger shows 3/4
    const trigger = mount.querySelector(
      '.board-filter-bar .filter-dropdown__trigger'
    );
    expect(trigger?.textContent).toContain('3/4');
  });

  test('invalid localStorage JSON falls back to all visible', async () => {
    localStorage.setItem(
      'beads-ui.board-col-vis:/test/project',
      'not valid json!!'
    );

    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore('/test/project'),
      issueStores
    });
    await view.load();

    // All 4 columns visible (fallback)
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(4);
  });
});

describe('views/board column visibility reconciliation', () => {
  test('new column not in stored state defaults to visible', async () => {
    // Stored state only knows about 3 columns (missing "closed")
    localStorage.setItem(
      'beads-ui.board-col-vis:/test/project',
      JSON.stringify({ blocked: true, ready: true, 'in-progress': false })
    );

    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore('/test/project'),
      issueStores
    });
    await view.load();

    // "in-progress" hidden, "closed" visible (new column defaults to visible)
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(3);
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).toContain('closed-col');
    expect(col_ids).not.toContain('in-progress-col');
  });

  test('removed column in stored state is pruned from persisted data', async () => {
    // Stored state has an extra column "archive" that no longer exists in col_defs
    localStorage.setItem(
      'beads-ui.board-col-vis:/test/project',
      JSON.stringify({
        blocked: true,
        ready: true,
        'in-progress': true,
        closed: false,
        archive: true
      })
    );

    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore('/test/project'),
      issueStores
    });
    await view.load();

    // "closed" should be hidden (stored as false), "archive" doesn't exist
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(3);
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).not.toContain('closed-col');
  });

  test('existing columns retain their stored visibility', async () => {
    localStorage.setItem(
      'beads-ui.board-col-vis:/test/project',
      JSON.stringify({
        blocked: false,
        ready: true,
        'in-progress': true,
        closed: false
      })
    );

    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedDefaultColumns(issueStores);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store: createMockStore('/test/project'),
      issueStores
    });
    await view.load();

    // Only "ready" and "in-progress" visible
    const columns = mount.querySelectorAll('.board-column');
    expect(columns.length).toBe(2);
    const col_ids = Array.from(columns).map((c) => c.id);
    expect(col_ids).toContain('ready-col');
    expect(col_ids).toContain('in-progress-col');
    expect(col_ids).not.toContain('blocked-col');
    expect(col_ids).not.toContain('closed-col');
  });
});
