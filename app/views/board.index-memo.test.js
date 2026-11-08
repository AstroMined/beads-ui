import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildDepIndex } from '../data/dep-graph.js';
import { BOARD_INDEX_CLIENT_ID } from '../data/graph-subscription.js';
import { flattenParentOptions } from '../data/parent-options.js';
import { createSubscriptionIssueStores } from '../data/subscription-issue-stores.js';
import { createBoardView } from './board.js';

vi.mock('../data/dep-graph.js', async (importOriginal) => {
  const actual = /** @type {typeof import('../data/dep-graph.js')} */ (
    await importOriginal()
  );
  return { ...actual, buildDepIndex: vi.fn(actual.buildDepIndex) };
});

vi.mock('../data/parent-options.js', async (importOriginal) => {
  const actual = /** @type {typeof import('../data/parent-options.js')} */ (
    await importOriginal()
  );
  return {
    ...actual,
    flattenParentOptions: vi.fn(actual.flattenParentOptions)
  };
});

const READY_ID = 'tab:board:ready';
const DETAIL_ID = 'detail:R-1';
const UPDATED_AT = 1;
const LATER_UPDATED_AT = 2;

/**
 * Push one envelope into a registered store.
 *
 * @param {ReturnType<typeof createSubscriptionIssueStores>} stores
 * @param {string} id
 * @param {Record<string, unknown>} msg
 */
function push(stores, id, msg) {
  const store = stores.getStore(id);
  if (!store) {
    throw new Error(`no store ${id}`);
  }
  store.applyPush(/** @type {any} */ ({ id, ...msg }));
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

describe('views/board dependency index memo', () => {
  beforeEach(() => {
    vi.mocked(buildDepIndex).mockClear();
    vi.mocked(flattenParentOptions).mockClear();
  });

  test('rebuilds the index and parent options only when a board store changes', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const stores = createSubscriptionIssueStores();
    stores.register(BOARD_INDEX_CLIENT_ID);
    stores.register(READY_ID);
    stores.register(DETAIL_ID);
    push(stores, READY_ID, {
      type: 'snapshot',
      revision: 1,
      issues: [
        { id: 'R-1', parent: 'A', updated_at: UPDATED_AT },
        { id: 'R-2', updated_at: UPDATED_AT }
      ]
    });

    const view = createBoardView({
      mount_element: mount,
      gotoIssue: () => {},
      issueStores: stores
    });
    await view.load();
    const index_builds = vi.mocked(buildDepIndex).mock.calls.length;
    const option_builds = vi.mocked(flattenParentOptions).mock.calls.length;

    // An envelope for an unrelated store leaves the inputs unchanged
    push(stores, DETAIL_ID, {
      type: 'snapshot',
      revision: 1,
      issues: [{ id: 'R-1', updated_at: UPDATED_AT }]
    });
    await view.load();
    expect(buildDepIndex).toHaveBeenCalledTimes(index_builds);
    expect(flattenParentOptions).toHaveBeenCalledTimes(option_builds);

    // An upsert that mutates a board item in place still rebuilds
    push(stores, READY_ID, {
      type: 'upsert',
      revision: 2,
      issue: { id: 'R-2', parent: 'B', updated_at: LATER_UPDATED_AT }
    });
    expect(buildDepIndex).toHaveBeenCalledTimes(index_builds + 1);
    expect(flattenParentOptions).toHaveBeenCalledTimes(option_builds + 1);
    expect(parentRowValues(mount)).toEqual(['', 'A', 'B']);

    // A board-index push rebuilds too
    push(stores, BOARD_INDEX_CLIENT_ID, {
      type: 'snapshot',
      revision: 1,
      issues: [{ id: 'A', parent: 'ROOT', updated_at: UPDATED_AT }]
    });
    expect(buildDepIndex).toHaveBeenCalledTimes(index_builds + 2);
    expect(parentRowValues(mount)).toEqual(['', 'B', 'ROOT', 'A']);
    view.clear();
  });
});
