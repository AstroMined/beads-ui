import { describe, expect, test, vi } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createStore } from '../state.js';
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

/** Base creation time for seeded issues; later seeds sort after earlier. */
const SEED_BASE_TIME = new Date('2025-10-20T08:00:00.000Z').getTime();

/** The four default board columns. */
const DEFAULT_COLUMN_IDS = ['blocked', 'ready', 'in-progress', 'closed'];

/**
 * Push a snapshot into one subscription store.
 *
 * @param {ReturnType<typeof createTestIssueStores>} issueStores
 * @param {string} id
 * @param {Array<Record<string, unknown>>} issues
 */
function pushSnapshot(issueStores, id, issues) {
  issueStores.getStore(id).applyPush({
    type: 'snapshot',
    id,
    revision: 1,
    issues
  });
}

/**
 * Seed every default column, giving each issue a title and increasing
 * creation times so the column order follows the listed order within a
 * priority.
 *
 * @param {ReturnType<typeof createTestIssueStores>} issueStores
 * @param {Record<string, Array<Record<string, unknown>>>} by_column
 */
function seedColumns(issueStores, by_column) {
  let seq = 0;
  for (const col_id of DEFAULT_COLUMN_IDS) {
    const issues = (by_column[col_id] || []).map((issue) => {
      seq += 1;
      const at = SEED_BASE_TIME + seq;
      return {
        title: String(issue.id),
        created_at: at,
        updated_at: at,
        ...issue
      };
    });
    pushSnapshot(issueStores, 'tab:board:' + col_id, issues);
  }
}

/**
 * @param {HTMLElement} mount
 * @param {string} col_id
 * @returns {Array<string|null>}
 */
function columnIds(mount, col_id) {
  return Array.from(mount.querySelectorAll(`#${col_id}-col .board-card`)).map(
    (el) => el.getAttribute('data-issue-id')
  );
}

/**
 * @param {HTMLElement} mount
 * @param {string} key
 * @returns {HTMLButtonElement}
 */
function triggerOf(mount, key) {
  const el = mount.querySelector(
    `[data-filter="${key}"] .filter-dropdown__trigger`
  );
  if (!el) {
    throw new Error(`no trigger for ${key}`);
  }
  return /** @type {HTMLButtonElement} */ (el);
}

/**
 * @param {HTMLElement} mount
 * @param {string} key
 * @returns {string[]}
 */
function optionLabels(mount, key) {
  return Array.from(
    mount.querySelectorAll(`[data-filter="${key}"] .filter-dropdown__option`)
  ).map((el) => String(el.textContent).trim());
}

/**
 * @param {HTMLElement} mount
 * @param {string} key
 * @param {string} label
 * @returns {HTMLInputElement}
 */
function optionInput(mount, key, label) {
  const found = Array.from(
    mount.querySelectorAll(`[data-filter="${key}"] .filter-dropdown__option`)
  ).find((el) => String(el.textContent).trim() === label);
  const input = found ? found.querySelector('input') : null;
  if (!input) {
    throw new Error(`no ${key} option ${label}`);
  }
  return input;
}

/**
 * @param {HTMLElement} mount
 * @returns {Array<string|null>}
 */
function parentRowValues(mount) {
  return Array.from(
    mount.querySelectorAll('.board-parent-picker__list [role="option"]')
  ).map((el) => el.getAttribute('data-value'));
}

/**
 * @param {HTMLElement} mount
 * @param {string} value - '' for the "Any parent" row.
 * @returns {HTMLElement}
 */
function parentRow(mount, value) {
  const el = mount.querySelector(
    `.board-parent-picker__list [role="option"][data-value="${value}"]`
  );
  if (!el) {
    throw new Error(`no parent row ${value}`);
  }
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {string} key
 */
function keydown(key) {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

/**
 * Dispatch a keydown on the focused element.
 *
 * @param {string} key
 */
function keydownOnFocused(key) {
  const el = document.activeElement;
  if (!el) {
    throw new Error('nothing focused');
  }
  el.dispatchEvent(keydown(key));
}

describe('views/board', () => {
  test('renders four columns (Blocked, Ready, In Progress, Closed) with sorted cards and navigates on click', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issues = [
      // Blocked
      {
        id: 'B-2',
        title: 'b2',
        priority: 1,
        created_at: new Date('2025-10-22T07:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-22T07:00:00.000Z').getTime(),
        issue_type: 'task'
      },
      {
        id: 'B-1',
        title: 'b1',
        priority: 0,
        created_at: new Date('2025-10-21T07:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-21T07:00:00.000Z').getTime(),
        issue_type: 'bug'
      },
      // Ready
      {
        id: 'R-2',
        title: 'r2',
        priority: 1,
        created_at: new Date('2025-10-20T08:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-20T08:00:00.000Z').getTime(),
        issue_type: 'task'
      },
      {
        id: 'R-1',
        title: 'r1',
        priority: 0,
        created_at: new Date('2025-10-21T08:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-21T08:00:00.000Z').getTime(),
        issue_type: 'bug'
      },
      {
        id: 'R-3',
        title: 'r3',
        priority: 1,
        created_at: new Date('2025-10-22T08:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-22T08:00:00.000Z').getTime(),
        issue_type: 'feature'
      },
      // In progress
      {
        id: 'P-1',
        title: 'p1',
        created_at: new Date('2025-10-23T09:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-23T09:00:00.000Z').getTime(),
        issue_type: 'task'
      },
      {
        id: 'P-2',
        title: 'p2',
        created_at: new Date('2025-10-22T09:00:00.000Z').getTime(),
        updated_at: new Date('2025-10-22T09:00:00.000Z').getTime(),
        issue_type: 'feature'
      },
      // Closed
      {
        id: 'C-2',
        title: 'c2',
        updated_at: new Date('2025-10-20T09:00:00.000Z').getTime(),
        closed_at: new Date(now).getTime(),
        issue_type: 'task'
      },
      {
        id: 'C-1',
        title: 'c1',
        updated_at: new Date('2025-10-21T09:00:00.000Z').getTime(),
        closed_at: new Date(now - 1000).getTime(),
        issue_type: 'bug'
      }
    ];
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: issues.filter((i) => i.id.startsWith('B-'))
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: issues.filter((i) => i.id.startsWith('R-'))
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: issues.filter((i) => i.id.startsWith('P-'))
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: issues.filter((i) => i.id.startsWith('C-'))
    });

    /** @type {string[]} */
    const navigations = [];
    const view = createBoardView({
      mount_element: mount,
      gotoIssue: (id) => {
        navigations.push(id);
      },
      issueStores
    });

    await view.load();

    // Blocked: priority asc, then created_at desc for equal priority
    const blocked_ids = Array.from(
      mount.querySelectorAll('#blocked-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(blocked_ids).toEqual(['B-1', 'B-2']);

    // Ready: priority asc, then created_at asc for equal priority
    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(ready_ids).toEqual(['R-1', 'R-2', 'R-3']);

    // In progress: priority asc (default), then created_at asc
    const prog_ids = Array.from(
      mount.querySelectorAll('#in-progress-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(prog_ids).toEqual(['P-2', 'P-1']);

    // Closed: closed_at desc
    const closed_ids = Array.from(
      mount.querySelectorAll('#closed-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(closed_ids).toEqual(['C-2', 'C-1']);

    // Click navigates
    const first_ready = /** @type {HTMLElement|null} */ (
      mount.querySelector('#ready-col .board-card')
    );
    first_ready?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigations[0]).toBe('R-1');
  });

  test('shows column count badges next to titles', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: [
        {
          id: 'B-1',
          title: 'blocked 1',
          created_at: now - 5,
          updated_at: now - 5,
          issue_type: 'task'
        },
        {
          id: 'B-2',
          title: 'blocked 2',
          created_at: now - 4,
          updated_at: now - 4,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'ready 1',
          created_at: now - 3,
          updated_at: now - 3,
          issue_type: 'feature'
        },
        {
          id: 'R-2',
          title: 'ready 2',
          created_at: now - 2,
          updated_at: now - 2,
          issue_type: 'task'
        },
        {
          id: 'R-3',
          title: 'ready 3',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: [
        {
          id: 'P-1',
          title: 'progress 1',
          created_at: now,
          updated_at: now,
          issue_type: 'feature'
        }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'closed 1',
          updated_at: now,
          closed_at: now,
          issue_type: 'chore'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });

    await view.load();

    const blocked_count = mount
      .querySelector('#blocked-col .board-column__count')
      ?.textContent?.trim();
    const ready_count = mount
      .querySelector('#ready-col .board-column__count')
      ?.textContent?.trim();
    const in_progress_count = mount
      .querySelector('#in-progress-col .board-column__count')
      ?.textContent?.trim();
    const closed_count = mount
      .querySelector('#closed-col .board-column__count')
      ?.textContent?.trim();

    expect(blocked_count).toBe('2');
    expect(ready_count).toBe('3');
    expect(in_progress_count).toBe('1');
    expect(closed_count).toBe('1');

    const closed_label = mount
      .querySelector('#closed-col .board-column__count')
      ?.getAttribute('aria-label');
    expect(closed_label).toBe('1 issue');
  });

  test('filters Ready to exclude items that are In Progress', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const issues = [
      {
        id: 'X-1',
        title: 'x1',
        priority: 1,
        created_at: '2025-10-23T10:00:00.000Z',
        updated_at: '2025-10-23T10:00:00.000Z',
        issue_type: 'task'
      },
      {
        id: 'X-2',
        title: 'x2',
        priority: 1,
        created_at: '2025-10-23T09:00:00.000Z',
        updated_at: '2025-10-23T09:00:00.000Z',
        issue_type: 'task'
      }
    ];
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: issues
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: issues.filter((i) => i.id.startsWith('X-2'))
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });

    await view.load();

    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card .mono')
    ).map((el) => el.textContent?.trim());

    // X-2 is in progress, so Ready should only show X-1
    expect(ready_ids).toEqual(['X-1']);

    const prog_ids = Array.from(
      mount.querySelectorAll('#in-progress-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(prog_ids).toEqual(['X-2']);
  });

  test('renders 5 columns when custom column config includes in_review', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const columns = [
      {
        id: 'blocked',
        label: 'Blocked',
        subscription: 'blocked-issues',
        drop_status: 'open'
      },
      {
        id: 'ready',
        label: 'Ready',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'in-progress',
        label: 'In Progress',
        subscription: 'in-progress-issues',
        drop_status: 'in_progress'
      },
      {
        id: 'in-review',
        label: 'In Review',
        subscription: 'status-issues',
        params: { status: 'in_review' },
        drop_status: 'in_progress'
      },
      {
        id: 'closed',
        label: 'Closed',
        subscription: 'closed-issues',
        drop_status: 'closed'
      }
    ];

    const issueStores = createTestIssueStores();
    // Push data to each column's store
    issueStores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: [
        {
          id: 'B-1',
          title: 'b1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'r1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: [
        {
          id: 'P-1',
          title: 'p1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: [
        {
          id: 'V-1',
          title: 'v1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'c1',
          updated_at: now,
          closed_at: now,
          issue_type: 'task'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      columns
    });

    await view.load();

    // Should render exactly 5 board-column sections
    const col_sections = mount.querySelectorAll('.board-column');
    expect(col_sections.length).toBe(5);

    // Verify column IDs
    const col_ids = Array.from(col_sections).map((el) => el.id);
    expect(col_ids).toEqual([
      'blocked-col',
      'ready-col',
      'in-progress-col',
      'in-review-col',
      'closed-col'
    ]);

    // Verify the In Review column label
    const review_label = mount
      .querySelector('#in-review-col .board-column__title-text')
      ?.textContent?.trim();
    expect(review_label).toBe('In Review');

    // Verify --board-columns CSS var is set to 5
    const board_root = /** @type {HTMLElement} */ (
      mount.querySelector('.board-root')
    );
    expect(board_root.style.getPropertyValue('--board-columns')).toBe('5');

    // Verify the in-review column has its card
    const review_ids = Array.from(
      mount.querySelectorAll('#in-review-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(review_ids).toEqual(['V-1']);
  });

  test('drop handler uses column drop_status value', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const columns = [
      {
        id: 'ready',
        label: 'Ready',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'in-review',
        label: 'In Review',
        subscription: 'status-issues',
        params: { status: 'in_review' },
        drop_status: 'in_progress'
      }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'T-1',
          title: 't1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: []
    });

    /** @type {Array<{id: string, status: string}>} */
    const status_updates = [];
    const transport = async (
      /** @type {string} */ type,
      /** @type {any} */ payload
    ) => {
      if (type === 'update-status') {
        status_updates.push({ id: payload.id, status: payload.status });
      }
    };

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      transport,
      columns
    });

    await view.load();

    // Simulate dropping T-1 on the in-review column
    const review_col = /** @type {HTMLElement} */ (
      mount.querySelector('#in-review-col')
    );
    const drop_event = new Event('drop', { bubbles: true });
    Object.defineProperty(drop_event, 'dataTransfer', {
      value: { getData: () => 'T-1' }
    });
    Object.defineProperty(drop_event, 'preventDefault', { value: () => {} });
    review_col.dispatchEvent(drop_event);

    // Wait for async transport call
    await new Promise((r) => setTimeout(r, 10));

    expect(status_updates).toEqual([{ id: 'T-1', status: 'in_progress' }]);
  });

  test('closed filter only applies to columns with closed-issues subscription', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const yesterday = now - 2 * 24 * 60 * 60 * 1000;
    const columns = [
      {
        id: 'ready',
        label: 'Ready',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'in-review',
        label: 'In Review',
        subscription: 'status-issues',
        params: { status: 'in_review' },
        drop_status: 'in_progress'
      },
      {
        id: 'closed',
        label: 'Closed',
        subscription: 'closed-issues',
        drop_status: 'closed'
      }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'r1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: [
        {
          id: 'V-1',
          title: 'v1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'today',
          updated_at: now,
          closed_at: now,
          issue_type: 'task'
        },
        {
          id: 'C-2',
          title: 'old',
          updated_at: yesterday,
          closed_at: yesterday,
          issue_type: 'task'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      columns
    });

    await view.load();

    // Closed filter (default 'today') should filter out yesterday's closed item
    const closed_ids = Array.from(
      mount.querySelectorAll('#closed-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(closed_ids).toEqual(['C-1']);

    // Non-closed columns should NOT be filtered
    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(ready_ids).toHaveLength(2);

    const review_ids = Array.from(
      mount.querySelectorAll('#in-review-col .board-card .mono')
    ).map((el) => el.textContent?.trim());
    expect(review_ids).toEqual(['V-1']);

    // Only closed column should have the filter dropdown
    const closed_filter = mount.querySelector(
      '#closed-col #closed-filter-closed'
    );
    expect(closed_filter).not.toBeNull();
    const review_filter = mount.querySelector(
      '#in-review-col #closed-filter-in-review'
    );
    expect(review_filter).toBeNull();
  });

  test('keyboard navigation works across dynamic column count', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const columns = [
      {
        id: 'col-a',
        label: 'A',
        subscription: 'blocked-issues',
        drop_status: 'open'
      },
      {
        id: 'col-b',
        label: 'B',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'col-c',
        label: 'C',
        subscription: 'in-progress-issues',
        drop_status: 'in_progress'
      }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:col-a').applyPush({
      type: 'snapshot',
      id: 'tab:board:col-a',
      revision: 1,
      issues: [
        {
          id: 'A-1',
          title: 'a1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });
    issueStores.getStore('tab:board:col-b').applyPush({
      type: 'snapshot',
      id: 'tab:board:col-b',
      revision: 1,
      issues: [] // Empty column
    });
    issueStores.getStore('tab:board:col-c').applyPush({
      type: 'snapshot',
      id: 'tab:board:col-c',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'c1',
          created_at: now,
          updated_at: now,
          issue_type: 'task'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      columns
    });

    await view.load();

    // First card in col-a should have tabindex=0
    const a_card = /** @type {HTMLElement} */ (
      mount.querySelector('#col-a-col .board-card')
    );
    expect(a_card.tabIndex).toBe(0);

    // ArrowRight from col-a should skip empty col-b and land on col-c
    a_card.focus();
    const right_event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true
    });
    a_card.dispatchEvent(right_event);

    const c_card = /** @type {HTMLElement} */ (
      mount.querySelector('#col-c-col .board-card')
    );
    expect(c_card.tabIndex).toBe(0);
    expect(a_card.tabIndex).toBe(-1);
  });

  test('filter bar renders Parent, Types, Priority, Assignee and Columns above the grid', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      blocked: [{ id: 'B-1', title: 'b1', parent: 'epic-1', assignee: 'a' }]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    const filter_bar = mount.querySelector('.board-filter-bar');
    expect(filter_bar).not.toBeNull();
    const keys = Array.from(
      filter_bar?.querySelectorAll('[data-filter]') || []
    ).map((el) => el.getAttribute('data-filter'));
    // No labels on the board: the Labels filter is hidden
    expect(keys).toEqual(['parent', 'types', 'priorities', 'columns']);
    // Assignee stays a single select
    const selects = filter_bar?.querySelectorAll('select');
    expect(selects?.length).toBe(1);
    expect(selects?.[0].getAttribute('aria-label')).toBe('Filter by assignee');
    // No filter active: no Clear filters button
    expect(filter_bar?.querySelector('.board-filter-bar__clear')).toBeNull();

    // Filter bar comes before the board grid
    const children = Array.from(mount.children);
    const board_root = mount.querySelector('.board-root');
    expect(children.indexOf(/** @type {Element} */ (filter_bar))).toBeLessThan(
      children.indexOf(/** @type {Element} */ (board_root))
    );

    // ARIA wiring of the Parent picker
    const trigger = triggerOf(mount, 'parent');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    const menu_id = String(trigger.getAttribute('aria-controls'));
    expect(mount.querySelector(`#${menu_id}`)).not.toBeNull();
  });

  test('filter options: known types first, P0 to P4, sorted assignees, parent tree', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      blocked: [
        {
          id: 'B-1',
          issue_type: 'spike',
          parent: 'epic-2',
          assignee: 'charlie'
        }
      ],
      ready: [
        { id: 'R-1', issue_type: 'bug', parent: 'epic-1', assignee: 'alice' },
        { id: 'R-2', issue_type: 'task', parent: 'epic-10', assignee: 'bob' }
      ],
      closed: [
        { id: 'C-1', issue_type: 'adr', closed_at: Date.now(), assignee: 'bob' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    expect(optionLabels(mount, 'types')).toEqual([
      'Bug',
      'Feature',
      'Task',
      'Epic',
      'Chore',
      'adr',
      'spike'
    ]);
    expect(optionLabels(mount, 'priorities')).toEqual([
      'P0 Critical',
      'P1 High',
      'P2 Medium',
      'P3 Low',
      'P4 Backlog'
    ]);
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    expect(Array.from(assignee_select.options).map((o) => o.value)).toEqual([
      '',
      'alice',
      'bob',
      'charlie'
    ]);
    // Parents in natural id order, after the "Any parent" row
    expect(parentRowValues(mount)).toEqual(['', 'epic-1', 'epic-2', 'epic-10']);
  });

  test('OR within a filter and AND across filters', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', issue_type: 'task', priority: 1, assignee: 'alice' },
        { id: 'R-2', issue_type: 'bug', priority: 1, assignee: 'alice' },
        { id: 'R-3', issue_type: 'chore', priority: 1, assignee: 'alice' },
        { id: 'R-4', issue_type: 'task', priority: 3, assignee: 'alice' },
        { id: 'R-5', issue_type: 'task', priority: 1, assignee: 'bob' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Types task OR bug; Ready sorts by priority, so the P3 task R-4 is last
    optionInput(mount, 'types', 'Task').click();
    optionInput(mount, 'types', 'Bug').click();
    expect(store.getState().board.board_filters.types).toEqual(['bug', 'task']);
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2', 'R-5', 'R-4']);

    // AND Priority P1
    optionInput(mount, 'priorities', 'P1 High').click();
    expect(store.getState().board.board_filters.priorities).toEqual([1]);
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2', 'R-5']);

    // AND Assignee alice
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    assignee_select.value = 'alice';
    assignee_select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2']);

    // Unchecking a type removes it from the OR set
    optionInput(mount, 'types', 'Bug').click();
    expect(columnIds(mount, 'ready')).toEqual(['R-1']);
    expect(triggerOf(mount, 'types').textContent).toContain('Types: Task');
  });

  test('Priority filter treats a missing priority as the default', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [{ id: 'R-1', priority: 0 }, { id: 'R-2' }]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    optionInput(mount, 'priorities', 'P2 Medium').click();
    expect(columnIds(mount, 'ready')).toEqual(['R-2']);
  });

  test('Labels filter appears with labels and matches card or index labels', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', labels: ['ui'] },
        { id: 'R-2' },
        { id: 'R-3', labels: ['server'] }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();
    expect(optionLabels(mount, 'labels')).toEqual(['server', 'ui']);

    // The index row of R-2 carries a label its card lacks
    pushSnapshot(issueStores, 'tab:board-index', [
      { id: 'R-2', labels: ['ui'] }
    ]);
    optionInput(mount, 'labels', 'ui').click();
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2']);

    optionInput(mount, 'labels', 'server').click();
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2', 'R-3']);
  });

  test('Parent matches the whole tree through a closed intermediate not on the board', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'E', issue_type: 'epic', title: 'Epic' },
        { id: 'T-1', parent: 'F' },
        { id: 'T-2', parent: 'OTHER' }
      ]
    });
    // F is closed and only known from the board index
    pushSnapshot(issueStores, 'tab:board-index', [
      { id: 'E', title: 'Epic', status: 'open' },
      { id: 'F', title: 'Feature', status: 'closed', parent: 'E' },
      { id: 'T-1', status: 'open', parent: 'F' }
    ]);

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Tree order: E, then its closed child F, then the unknown OTHER
    expect(parentRowValues(mount)).toEqual(['', 'E', 'F', 'OTHER']);
    const f_row = parentRow(mount, 'F');
    expect(f_row.classList.contains('is-muted')).toBe(true);
    expect(f_row.getAttribute('style')).toContain('--parent-depth: 1');

    triggerOf(mount, 'parent').click();
    parentRow(mount, 'E').click();
    expect(store.getState().board.board_filters.parent).toBe('E');
    // The parent itself and its grandchild through F
    expect(columnIds(mount, 'ready')).toEqual(['E', 'T-1']);
    expect(triggerOf(mount, 'parent').textContent).toContain('Parent: E');
  });

  test('Parent falls back to the board items when there is no index yet', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'E', issue_type: 'epic' },
        { id: 'E.1', parent: 'E' },
        { id: 'T-1', parent: 'F' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Without the index F's parent is unknown, so E does not reach T-1
    expect(parentRowValues(mount)).toEqual(['', 'E', 'F']);
    triggerOf(mount, 'parent').click();
    parentRow(mount, 'E').click();
    expect(columnIds(mount, 'ready')).toEqual(['E', 'E.1']);

    triggerOf(mount, 'parent').click();
    parentRow(mount, 'F').click();
    expect(columnIds(mount, 'ready')).toEqual(['T-1']);
  });

  test('ArrowDown in the Parent picker moves focus without committing', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'A-1', parent: 'A' },
        { id: 'B-1', parent: 'B' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    triggerOf(mount, 'parent').click();
    expect(triggerOf(mount, 'parent').getAttribute('aria-expanded')).toBe(
      'true'
    );
    const search = /** @type {HTMLInputElement} */ (
      mount.querySelector('.board-parent-picker__search')
    );
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(keydown('ArrowDown'));
    expect(document.activeElement).toBe(parentRow(mount, ''));
    keydownOnFocused('ArrowDown');
    keydownOnFocused('ArrowDown');
    expect(document.activeElement).toBe(parentRow(mount, 'B'));
    keydownOnFocused('ArrowUp');
    expect(document.activeElement).toBe(parentRow(mount, 'A'));

    // Moving focus commits nothing and keeps the picker open
    expect(store.getState().board.board_filters.parent).toBeNull();
    expect(columnIds(mount, 'ready')).toEqual(['A-1', 'B-1']);
    expect(triggerOf(mount, 'parent').getAttribute('aria-expanded')).toBe(
      'true'
    );

    keydownOnFocused('Enter');
    expect(store.getState().board.board_filters.parent).toBe('A');
    expect(columnIds(mount, 'ready')).toEqual(['A-1']);
    expect(triggerOf(mount, 'parent').getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  test('Parent picker search keeps matching rows and their ancestors', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'E', title: 'Epic' },
        { id: 'E.1', title: 'Login flow', parent: 'E' },
        { id: 'E.1.1', parent: 'E.1' },
        { id: 'E.2', title: 'Billing', parent: 'E' },
        { id: 'E.2.1', parent: 'E.2' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    triggerOf(mount, 'parent').click();
    const search = /** @type {HTMLInputElement} */ (
      mount.querySelector('.board-parent-picker__search')
    );
    search.value = 'login';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(parentRowValues(mount)).toEqual(['', 'E', 'E.1']);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(parentRowValues(mount)).toEqual(['']);
    expect(
      mount.querySelector('.board-parent-picker__empty')?.textContent
    ).toContain('No matches');
  });

  test('a stale Parent selection shows as not found', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({
      view: 'board',
      board: { board_filters: { parent: 'GONE-1' } }
    });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, { ready: [{ id: 'R-1' }] });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    expect(triggerOf(mount, 'parent').textContent).toContain(
      'Parent: GONE-1 (not found)'
    );
    expect(columnIds(mount, 'ready')).toEqual([]);
  });

  test('Clear filters resets every filter and hides itself', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({
      view: 'board',
      board: {
        board_filters: {
          assignee: 'alice',
          types: ['bug'],
          priorities: [0],
          labels: ['ui']
        }
      }
    });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', assignee: 'alice', issue_type: 'bug', priority: 0 },
        { id: 'R-2', assignee: 'bob', labels: ['ui'] }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();
    expect(columnIds(mount, 'ready')).toEqual([]);

    const clear_btn = /** @type {HTMLButtonElement} */ (
      mount.querySelector('.board-filter-bar__clear')
    );
    expect(clear_btn.textContent?.trim()).toBe('Clear filters');
    clear_btn.click();

    expect(store.getState().board.board_filters).toEqual({
      parent: null,
      assignee: null,
      types: [],
      priorities: [],
      labels: []
    });
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2']);
    expect(mount.querySelector('.board-filter-bar__clear')).toBeNull();
  });

  test('each filter click saves once and does not re-read the stores', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({ view: 'board' });
    const set_state = vi.spyOn(store, 'setState');
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', issue_type: 'task' },
        { id: 'R-2', issue_type: 'bug' }
      ]
    });
    const snapshot_for = vi.spyOn(issueStores, 'snapshotFor');

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();
    set_state.mockClear();
    snapshot_for.mockClear();

    optionInput(mount, 'types', 'Task').click();
    expect(set_state).toHaveBeenCalledTimes(1);
    expect(snapshot_for).not.toHaveBeenCalled();
    expect(columnIds(mount, 'ready')).toEqual(['R-1']);
  });

  test('a legacy single type in the store reads as a Types selection', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    // Ad-hoc store that keeps the pre-array shape as given
    const store = {
      getState: () => ({
        board: {
          closed_filter: 'today',
          board_filters: { parent: null, assignee: null, type: 'task' }
        }
      }),
      setState() {},
      subscribe() {
        return () => {};
      }
    };
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', issue_type: 'task' },
        { id: 'R-2', issue_type: 'bug' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    expect(optionInput(mount, 'types', 'Task').checked).toBe(true);
    // Options are computed before filtering, so Bug is still listed
    expect(optionLabels(mount, 'types')).toContain('Bug');
    expect(columnIds(mount, 'ready')).toEqual(['R-1']);
  });

  test('clearing all filters restores full board view', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const store = createStore({
      view: 'board',
      board: { board_filters: { assignee: 'alice' } }
    });
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, {
      ready: [
        { id: 'R-1', assignee: 'alice' },
        { id: 'R-2', assignee: 'bob' }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();
    expect(columnIds(mount, 'ready')).toEqual(['R-1']);

    // Clear the assignee filter by selecting "All Assignees"
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    assignee_select.value = '';
    assignee_select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(columnIds(mount, 'ready')).toEqual(['R-1', 'R-2']);
  });

  test('clear() disposes the filter dropdown controller', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedColumns(issueStores, { ready: [{ id: 'R-1', issue_type: 'task' }] });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    triggerOf(mount, 'types').click();
    expect(triggerOf(mount, 'types').getAttribute('aria-expanded')).toBe(
      'true'
    );
    view.clear();
    expect(mount.children.length).toBe(0);

    // A live controller would close the menu and re-render into the mount
    document.dispatchEvent(keydown('Escape'));
    document.body.click();
    expect(mount.children.length).toBe(0);
  });

  test('filtering works across dynamic column counts (5 columns)', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const columns = [
      {
        id: 'blocked',
        label: 'Blocked',
        subscription: 'blocked-issues',
        drop_status: 'open'
      },
      {
        id: 'ready',
        label: 'Ready',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'in-progress',
        label: 'In Progress',
        subscription: 'in-progress-issues',
        drop_status: 'in_progress'
      },
      {
        id: 'in-review',
        label: 'In Review',
        subscription: 'status-issues',
        params: { status: 'in_review' },
        drop_status: 'in_progress'
      },
      {
        id: 'closed',
        label: 'Closed',
        subscription: 'closed-issues',
        drop_status: 'closed'
      }
    ];

    const store = {
      state: {
        selected_id: null,
        view: 'board',
        filters: { status: 'all', search: '', type: '' },
        board: {
          closed_filter: 'today',
          board_filters: { parent: null, assignee: null, type: null }
        }
      },
      subs: /** @type {((s:any)=>void)[]} */ ([]),
      getState() {
        return this.state;
      },
      /** @param {any} patch */
      setState(patch) {
        this.state = {
          ...this.state,
          ...(patch || {}),
          filters: { ...this.state.filters, ...(patch.filters || {}) },
          board: {
            ...this.state.board,
            ...(patch.board || {}),
            board_filters: {
              ...this.state.board.board_filters,
              ...(patch.board?.board_filters || {})
            }
          }
        };
        for (const fn of this.subs) {
          fn(this.state);
        }
      },
      /** @param {(s:any)=>void} fn */
      subscribe(fn) {
        this.subs.push(fn);
        return () => {
          this.subs = this.subs.filter((f) => f !== fn);
        };
      }
    };

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: [
        {
          id: 'B-1',
          title: 'b1',
          created_at: now,
          updated_at: now,
          issue_type: 'task',
          assignee: 'alice'
        }
      ]
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'r1',
          created_at: now,
          updated_at: now,
          issue_type: 'bug',
          assignee: 'bob'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: [
        {
          id: 'P-1',
          title: 'p1',
          created_at: now,
          updated_at: now,
          issue_type: 'task',
          assignee: 'alice'
        }
      ]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: [
        {
          id: 'V-1',
          title: 'v1',
          created_at: now,
          updated_at: now,
          issue_type: 'feature',
          assignee: 'charlie'
        }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'c1',
          updated_at: now,
          closed_at: now,
          issue_type: 'task',
          assignee: 'alice'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores,
      columns
    });
    await view.load();

    // All 5 columns rendered
    expect(mount.querySelectorAll('.board-column').length).toBe(5);

    // Filter by assignee=alice
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    assignee_select.value = 'alice';
    assignee_select.dispatchEvent(new Event('change', { bubbles: true }));

    // Blocked: B-1 (alice) visible
    const blocked = Array.from(
      mount.querySelectorAll('#blocked-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(blocked).toEqual(['B-1']);

    // Ready: R-1 (bob) filtered out
    const ready = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready).toEqual([]);

    // In Progress: P-1 (alice) visible
    const prog = Array.from(
      mount.querySelectorAll('#in-progress-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(prog).toEqual(['P-1']);

    // In Review: V-1 (charlie) filtered out
    const review = Array.from(
      mount.querySelectorAll('#in-review-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(review).toEqual([]);

    // Closed: C-1 (alice) visible
    const closed = Array.from(
      mount.querySelectorAll('#closed-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(closed).toEqual(['C-1']);
  });

  test('clear() removes event listeners and unsubscribes from selectors', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'Ready',
          status: 'open',
          priority: 1,
          created_at: now
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    // Board is rendered
    expect(mount.querySelectorAll('.board-card').length).toBeGreaterThan(0);

    // Clear should remove all children and not throw
    view.clear();
    expect(mount.children.length).toBe(0);

    // After clear, pushing new data should not re-render (unsubscribed)
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 2,
      issues: [
        {
          id: 'R-1',
          title: 'Ready',
          status: 'open',
          priority: 1,
          created_at: now
        },
        {
          id: 'R-2',
          title: 'Ready2',
          status: 'open',
          priority: 2,
          created_at: now
        }
      ]
    });
    // Mount should still be empty since we cleared (unsubscribed)
    expect(mount.children.length).toBe(0);
  });

  test('columnToMode returns closed for closed drop_status columns', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issueStores = createTestIssueStores();
    const custom_cols = [
      {
        id: 'open',
        label: 'Open',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'done',
        label: 'Done',
        subscription: 'custom-done',
        drop_status: 'closed'
      }
    ];

    issueStores.getStore('tab:board:done').applyPush({
      type: 'snapshot',
      id: 'tab:board:done',
      revision: 1,
      issues: [
        {
          id: 'D-1',
          title: 'Done',
          status: 'closed',
          priority: 1,
          closed_at: now,
          created_at: now - 1000
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      columns: custom_cols
    });
    await view.load();

    // The done column should render (closed semantics from drop_status)
    const done_section = mount.querySelector('#done-col');
    expect(done_section).not.toBeNull();
  });

  test('applyBoardFilters handles undefined filter values without filtering', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'One',
          status: 'open',
          priority: 1,
          created_at: now,
          parent: 'P-1'
        },
        {
          id: 'R-2',
          title: 'Two',
          status: 'open',
          priority: 2,
          created_at: now
        }
      ]
    });

    // Store with board_filters where parent is undefined (not null)
    const store = {
      getState: () => ({
        board: {
          closed_filter: 'today',
          board_filters: { parent: undefined, assignee: null, type: null }
        }
      }),
      setState() {},
      subscribe() {
        return () => {};
      }
    };

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Both items should be visible (undefined parent filter should not filter)
    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toEqual(['R-1', 'R-2']);
  });

  test('is_closed flag is set on ColumnDef for closed columns', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const issueStores = createTestIssueStores();
    const cols = [
      {
        id: 'open',
        label: 'Open',
        subscription: 'ready-issues',
        drop_status: 'open'
      },
      {
        id: 'done',
        label: 'Done',
        subscription: 'closed-issues',
        drop_status: 'closed'
      }
    ];

    issueStores.getStore('tab:board:done').applyPush({
      type: 'snapshot',
      id: 'tab:board:done',
      revision: 1,
      issues: [
        {
          id: 'D-1',
          title: 'Done',
          status: 'closed',
          priority: 1,
          closed_at: now,
          created_at: now - 1000
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores,
      columns: cols
    });
    await view.load();

    // Closed column should have the closed filter dropdown
    const filter_select = mount.querySelector('#done-col .board-closed-filter');
    expect(filter_select).not.toBeNull();

    // Non-closed column should NOT have it
    const open_filter = mount.querySelector('#open-col .board-closed-filter');
    expect(open_filter).toBeNull();
  });
});
