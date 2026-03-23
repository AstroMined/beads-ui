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
    const view = createBoardView(
      mount,
      null,
      (id) => {
        navigations.push(id);
      },
      undefined,
      undefined,
      issueStores
    );

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

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores
    );

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

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores
    );

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
      { id: 'blocked', label: 'Blocked', subscription: 'blocked-issues', drop_status: 'open' },
      { id: 'ready', label: 'Ready', subscription: 'ready-issues', drop_status: 'open' },
      { id: 'in-progress', label: 'In Progress', subscription: 'in-progress-issues', drop_status: 'in_progress' },
      { id: 'in-review', label: 'In Review', subscription: 'status-issues', params: { status: 'in_review' }, drop_status: 'in_progress' },
      { id: 'closed', label: 'Closed', subscription: 'closed-issues', drop_status: 'closed' }
    ];

    const issueStores = createTestIssueStores();
    // Push data to each column's store
    issueStores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: [{ id: 'B-1', title: 'b1', created_at: now, updated_at: now, issue_type: 'task' }]
    });
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [{ id: 'R-1', title: 'r1', created_at: now, updated_at: now, issue_type: 'task' }]
    });
    issueStores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: [{ id: 'P-1', title: 'p1', created_at: now, updated_at: now, issue_type: 'task' }]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: [{ id: 'V-1', title: 'v1', created_at: now, updated_at: now, issue_type: 'task' }]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [{ id: 'C-1', title: 'c1', updated_at: now, closed_at: now, issue_type: 'task' }]
    });

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores,
      undefined,
      columns
    );

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
      { id: 'ready', label: 'Ready', subscription: 'ready-issues', drop_status: 'open' },
      { id: 'in-review', label: 'In Review', subscription: 'status-issues', params: { status: 'in_review' }, drop_status: 'in_progress' }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [{ id: 'T-1', title: 't1', created_at: now, updated_at: now, issue_type: 'task' }]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: []
    });

    /** @type {Array<{id: string, status: string}>} */
    const status_updates = [];
    const transport = async (/** @type {string} */ type, /** @type {any} */ payload) => {
      if (type === 'update-status') {
        status_updates.push({ id: payload.id, status: payload.status });
      }
    };

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores,
      transport,
      columns
    );

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
      { id: 'ready', label: 'Ready', subscription: 'ready-issues', drop_status: 'open' },
      { id: 'in-review', label: 'In Review', subscription: 'status-issues', params: { status: 'in_review' }, drop_status: 'in_progress' },
      { id: 'closed', label: 'Closed', subscription: 'closed-issues', drop_status: 'closed' }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        { id: 'R-1', title: 'r1', created_at: now, updated_at: now, issue_type: 'task' },
        { id: 'R-2', title: 'r2', created_at: now - 1, updated_at: now - 1, issue_type: 'task' }
      ]
    });
    issueStores.getStore('tab:board:in-review').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-review',
      revision: 1,
      issues: [
        { id: 'V-1', title: 'v1', created_at: now, updated_at: now, issue_type: 'task' }
      ]
    });
    issueStores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        { id: 'C-1', title: 'today', updated_at: now, closed_at: now, issue_type: 'task' },
        { id: 'C-2', title: 'old', updated_at: yesterday, closed_at: yesterday, issue_type: 'task' }
      ]
    });

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores,
      undefined,
      columns
    );

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
    const closed_filter = mount.querySelector('#closed-col #closed-filter');
    expect(closed_filter).not.toBeNull();
    const review_filter = mount.querySelector('#in-review-col #closed-filter');
    expect(review_filter).toBeNull();
  });

  test('keyboard navigation works across dynamic column count', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));

    const now = Date.now();
    const columns = [
      { id: 'col-a', label: 'A', subscription: 'blocked-issues', drop_status: 'open' },
      { id: 'col-b', label: 'B', subscription: 'ready-issues', drop_status: 'open' },
      { id: 'col-c', label: 'C', subscription: 'in-progress-issues', drop_status: 'in_progress' }
    ];

    const issueStores = createTestIssueStores();
    issueStores.getStore('tab:board:col-a').applyPush({
      type: 'snapshot',
      id: 'tab:board:col-a',
      revision: 1,
      issues: [{ id: 'A-1', title: 'a1', created_at: now, updated_at: now, issue_type: 'task' }]
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
      issues: [{ id: 'C-1', title: 'c1', created_at: now, updated_at: now, issue_type: 'task' }]
    });

    const view = createBoardView(
      mount,
      null,
      () => {},
      undefined,
      undefined,
      issueStores,
      undefined,
      columns
    );

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
});
