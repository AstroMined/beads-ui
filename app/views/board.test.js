import { describe, expect, test } from 'vitest';
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

  test('filter bar renders three select dropdowns above the board grid', async () => {
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
          title: 'b1',
          created_at: now,
          updated_at: now,
          issue_type: 'task',
          parent: 'epic-1',
          assignee: 'alice'
        }
      ]
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: []
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: []
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: []
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    // Filter bar should render above the board grid
    const filter_bar = mount.querySelector('.board-filter-bar');
    expect(filter_bar).not.toBeNull();

    // Three select dropdowns
    const selects = filter_bar?.querySelectorAll('select');
    expect(selects?.length).toBe(3);

    // Board root should still exist
    const board_root = mount.querySelector('.board-root');
    expect(board_root).not.toBeNull();

    // Filter bar should come before board-root in DOM
    const children = Array.from(mount.children);
    const filter_idx = children.indexOf(/** @type {Element} */ (filter_bar));
    const board_idx = children.indexOf(/** @type {Element} */ (board_root));
    expect(filter_idx).toBeLessThan(board_idx);
  });

  test('filter dropdowns populate with unique sorted values from issue data', async () => {
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
          title: 'b1',
          created_at: now,
          updated_at: now,
          issue_type: 'task',
          parent: 'epic-2',
          assignee: 'charlie'
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
          parent: 'epic-1',
          assignee: 'alice'
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'task',
          parent: 'epic-2',
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
          issue_type: 'feature',
          parent: 'epic-1',
          assignee: 'alice'
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
          issue_type: 'bug',
          assignee: 'bob'
        }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores
    });
    await view.load();

    // Parent dropdown options (sorted alphabetically)
    const parent_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by parent"]')
    );
    const parent_opts = Array.from(parent_select.options).map((o) => o.value);
    // First option is "All Parents" with empty value
    expect(parent_opts[0]).toBe('');
    // Unique parents sorted
    expect(parent_opts.slice(1)).toEqual(['epic-1', 'epic-2']);

    // Assignee dropdown
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    const assignee_opts = Array.from(assignee_select.options).map(
      (o) => o.value
    );
    expect(assignee_opts[0]).toBe('');
    expect(assignee_opts.slice(1)).toEqual(['alice', 'bob', 'charlie']);

    // Type dropdown
    const type_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by type"]')
    );
    const type_opts = Array.from(type_select.options).map((o) => o.value);
    expect(type_opts[0]).toBe('');
    expect(type_opts.slice(1)).toEqual(['bug', 'feature', 'task']);
  });

  test('single filter active reduces visible cards to matching issues', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
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
      issues: []
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
          issue_type: 'task',
          parent: 'epic-1',
          assignee: 'alice'
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'bug',
          parent: 'epic-2',
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
          parent: 'epic-1',
          assignee: 'charlie'
        }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: []
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Initially all visible
    let ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toHaveLength(2);

    let prog_ids = Array.from(
      mount.querySelectorAll('#in-progress-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(prog_ids).toHaveLength(1);

    // Apply type filter = 'task' via select change
    const type_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by type"]')
    );
    type_select.value = 'task';
    type_select.dispatchEvent(new Event('change', { bubbles: true }));

    // Only task issues should be visible
    ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toEqual(['R-1']);

    prog_ids = Array.from(
      mount.querySelectorAll('#in-progress-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(prog_ids).toEqual(['P-1']);
  });

  test('combined filters apply AND logic (intersection)', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
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
      issues: []
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
          issue_type: 'task',
          parent: 'epic-1',
          assignee: 'alice'
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'task',
          parent: 'epic-2',
          assignee: 'bob'
        },
        {
          id: 'R-3',
          title: 'r3',
          created_at: now - 2,
          updated_at: now - 2,
          issue_type: 'bug',
          parent: 'epic-1',
          assignee: 'alice'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: []
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: []
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Apply type=task AND parent=epic-1 (should only match R-1)
    const type_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by type"]')
    );
    type_select.value = 'task';
    type_select.dispatchEvent(new Event('change', { bubbles: true }));

    const parent_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by parent"]')
    );
    parent_select.value = 'epic-1';
    parent_select.dispatchEvent(new Event('change', { bubbles: true }));

    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    // R-1 matches both type=task AND parent=epic-1
    // R-2 matches type=task but NOT parent=epic-1
    // R-3 matches parent=epic-1 but NOT type=task
    expect(ready_ids).toEqual(['R-1']);
  });

  test('clearing all filters restores full board view', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const store = {
      state: {
        selected_id: null,
        view: 'board',
        filters: { status: 'all', search: '', type: '' },
        board: {
          closed_filter: 'today',
          board_filters: { parent: null, assignee: 'alice', type: null }
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
      issues: []
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
          issue_type: 'task',
          assignee: 'alice'
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'task',
          assignee: 'bob'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: []
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: []
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // With assignee=alice filter, only R-1 visible
    let ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toEqual(['R-1']);

    // Clear the assignee filter by selecting "All Assignees"
    const assignee_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by assignee"]')
    );
    assignee_select.value = '';
    assignee_select.dispatchEvent(new Event('change', { bubbles: true }));

    // Both issues should be visible again
    ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toHaveLength(2);
  });

  test('filter options computed BEFORE filtering (dropdowns show all values)', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const store = {
      state: {
        selected_id: null,
        view: 'board',
        filters: { status: 'all', search: '', type: '' },
        board: {
          closed_filter: 'today',
          board_filters: { parent: null, assignee: null, type: 'task' }
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
      issues: []
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
        },
        {
          id: 'R-2',
          title: 'r2',
          created_at: now - 1,
          updated_at: now - 1,
          issue_type: 'bug'
        }
      ]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: []
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: []
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      store,
      issueStores
    });
    await view.load();

    // Even though type=task filter is active, the type dropdown
    // should still show both 'bug' and 'task' options
    const type_select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('[aria-label="Filter by type"]')
    );
    const type_opts = Array.from(type_select.options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(type_opts).toEqual(['bug', 'task']);

    // But only task issues should be visible in the board
    const ready_ids = Array.from(
      mount.querySelectorAll('#ready-col .board-card')
    ).map((el) => el.getAttribute('data-issue-id'));
    expect(ready_ids).toEqual(['R-1']);
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
});
