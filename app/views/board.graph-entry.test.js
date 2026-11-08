import { describe, expect, test } from 'vitest';
import { BOARD_INDEX_CLIENT_ID } from '../data/graph-subscription.js';
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
          fn();
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

/** Creation time for seeded issues. */
const SEED_TIME = new Date('2025-10-20T08:00:00.000Z').getTime();

/** Ready column subscription id. */
const READY_CLIENT_ID = 'tab:board:ready';

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
    issues: issues.map((issue) => ({ created_at: SEED_TIME, ...issue }))
  });
}

/**
 * Mount a board whose Ready column holds `ready`, with an optional
 * board-index snapshot, and record navigation calls.
 *
 * @param {{
 *   ready: Array<Record<string, unknown>>,
 *   index?: Array<Record<string, unknown>>,
 *   with_graph?: boolean
 * }} seed
 */
async function mountBoard(seed) {
  document.body.innerHTML = '<div id="m"></div>';
  const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
  const issueStores = createTestIssueStores();
  if (seed.index) {
    pushSnapshot(issueStores, BOARD_INDEX_CLIENT_ID, seed.index);
  }
  pushSnapshot(issueStores, READY_CLIENT_ID, seed.ready);
  /** @type {string[]} */
  const issues_opened = [];
  /** @type {string[]} */
  const graphs_opened = [];
  const view = createBoardView({
    mount_element: mount,
    gotoIssue: (id) => {
      issues_opened.push(id);
    },
    gotoGraph:
      seed.with_graph === false
        ? undefined
        : (id) => {
            graphs_opened.push(id);
          },
    issueStores
  });
  await view.load();
  return { mount, issues_opened, graphs_opened };
}

/**
 * @param {HTMLElement} mount
 * @param {string} id
 */
function cardOf(mount, id) {
  return /** @type {HTMLElement} */ (
    mount.querySelector(`.board-card[data-issue-id="${id}"]`)
  );
}

/**
 * @param {HTMLElement} mount
 * @param {string} id
 */
function graphButtonOf(mount, id) {
  return /** @type {HTMLButtonElement|null} */ (
    cardOf(mount, id).querySelector('.board-card__graph')
  );
}

/**
 * @param {HTMLElement} el
 * @param {string} key
 * @param {KeyboardEventInit} [init]
 */
function pressKey(el, key, init = {}) {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  );
}

const BLOCKS_EDGE = { depends_on_id: 'A-1', type: 'blocks' };

describe('views/board graph entry', () => {
  test('renders the graph button only on cards with ordering relations', async () => {
    const { mount } = await mountBoard({
      ready: [
        { id: 'B-1', title: 'blocked by A', dependencies: [BLOCKS_EDGE] },
        {
          id: 'C-1',
          title: 'child only',
          dependencies: [{ depends_on_id: 'E-1', type: 'parent-child' }]
        },
        { id: 'D-1', title: 'loose' }
      ]
    });

    const button = graphButtonOf(mount, 'B-1');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Open B-1 in graph');
    expect(button?.type).toBe('button');
    expect(graphButtonOf(mount, 'C-1')).toBeNull();
    expect(graphButtonOf(mount, 'D-1')).toBeNull();
  });

  test('renders the graph button when only the index entry qualifies', async () => {
    const { mount } = await mountBoard({
      ready: [{ id: 'A-1', title: 'blocker' }],
      index: [
        { id: 'A-1', title: 'blocker' },
        { id: 'B-1', title: 'blocked', dependencies: [BLOCKS_EDGE] }
      ]
    });

    expect(graphButtonOf(mount, 'A-1')).not.toBeNull();
  });

  test('renders no graph button without a gotoGraph option', async () => {
    const { mount } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }],
      with_graph: false
    });

    expect(graphButtonOf(mount, 'B-1')).toBeNull();
  });

  test('clicking the graph button opens the graph, not the details', async () => {
    const { mount, issues_opened, graphs_opened } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }]
    });

    graphButtonOf(mount, 'B-1')?.click();

    expect(graphs_opened).toEqual(['B-1']);
    expect(issues_opened).toEqual([]);
  });

  test('Enter and Space on the graph button do not open the details', async () => {
    const { mount, issues_opened } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }]
    });
    const button = /** @type {HTMLButtonElement} */ (
      graphButtonOf(mount, 'B-1')
    );
    button.focus();

    pressKey(button, 'Enter');
    pressKey(button, ' ');
    pressKey(button, 'g');

    expect(issues_opened).toEqual([]);
  });

  test('g on a focused qualifying card opens the graph', async () => {
    const { mount, issues_opened, graphs_opened } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }]
    });
    const card = cardOf(mount, 'B-1');
    card.focus();

    pressKey(card, 'g');

    expect(graphs_opened).toEqual(['B-1']);
    expect(issues_opened).toEqual([]);
  });

  test('g does nothing on a card without ordering relations', async () => {
    const { mount, issues_opened, graphs_opened } = await mountBoard({
      ready: [{ id: 'D-1', title: 'loose' }]
    });
    const card = cardOf(mount, 'D-1');
    card.focus();

    pressKey(card, 'g');

    expect(graphs_opened).toEqual([]);
    expect(issues_opened).toEqual([]);
  });

  test('g with a modifier key is left to the browser', async () => {
    const { mount, graphs_opened } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }]
    });
    const card = cardOf(mount, 'B-1');
    card.focus();

    pressKey(card, 'g', { ctrlKey: true });
    pressKey(card, 'g', { metaKey: true });

    expect(graphs_opened).toEqual([]);
  });

  test('Enter on a focused card still opens the details', async () => {
    const { mount, issues_opened, graphs_opened } = await mountBoard({
      ready: [{ id: 'B-1', title: 'b', dependencies: [BLOCKS_EDGE] }]
    });
    const card = cardOf(mount, 'B-1');
    card.focus();

    pressKey(card, 'Enter');

    expect(issues_opened).toEqual(['B-1']);
    expect(graphs_opened).toEqual([]);
  });
});
