import { describe, expect, test, vi } from 'vitest';
import {
  MAX_GRAPH_NODES,
  buildDepIndex,
  computeSuggestions
} from '../data/dep-graph.js';
import {
  GRAPH_CLIENT_ID,
  graphIssuesSpec
} from '../data/graph-subscription.js';
import { createSubscriptionIssueStores } from '../data/subscription-issue-stores.js';
import { createStore } from '../state.js';
import { createGraphView } from './graph.js';

vi.mock(import('../data/dep-graph.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildDepIndex: vi.fn(actual.buildDepIndex),
    computeSuggestions: vi.fn(actual.computeSuggestions)
  };
});

/**
 * @typedef {import('../../types/subscriptions.js').Issue & { parent?: string | null }} Row
 */

/** Prerequisites per level in the truncation fixture. */
const FAN_OUT = 10;
/** Prerequisites of each first-level prerequisite in that fixture. */
const FAN_IN = 14;
/** Upserts pushed in one task by the coalescing test. */
const BURST_SIZE = 5;

/**
 * @param {string} target
 * @returns {{ id: string, type: string }}
 */
function blockedBy(target) {
  return { id: target, type: 'blocks' };
}

/**
 * @param {string} target
 * @returns {{ id: string, type: string }}
 */
function relatedTo(target) {
  return { id: target, type: 'related' };
}

/**
 * @param {string} id
 * @param {Partial<Row>} [extra]
 * @returns {Row}
 */
function row(id, extra = {}) {
  return {
    id,
    title: `Title ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...extra
  };
}

/** C blocks B blocks A blocks D. */
function chainRows() {
  return [
    row('C'),
    row('B', { dependencies: [blockedBy('C')] }),
    row('A', { dependencies: [blockedBy('B')] }),
    row('D', { dependencies: [blockedBy('A')] })
  ];
}

/**
 * A two-level slice around A whose refocus on Y draws fewer, reordered nodes:
 * Y blocks X and Z, X and B block A, C blocks B, A blocks D.
 */
function refocusRows() {
  return [
    row('C'),
    row('Y'),
    row('X', { dependencies: [blockedBy('Y')] }),
    row('B', { dependencies: [blockedBy('C')] }),
    row('A', { dependencies: [blockedBy('B'), blockedBy('X')] }),
    row('D', { dependencies: [blockedBy('A')] }),
    row('Z', { dependencies: [blockedBy('Y')] })
  ];
}

/** X blocks the epic E, which holds E1 and E2. */
function containerRows() {
  return [
    row('X'),
    row('E', { issue_type: 'epic', dependencies: [blockedBy('X')] }),
    row('E1', { parent: 'E' }),
    row('E2', { parent: 'E' })
  ];
}

/**
 * @param {{ rows?: Row[], focus?: string | null, loaded?: boolean }} [options]
 */
function setup(options = {}) {
  const { rows = [], focus = null, loaded = true } = options;
  document.body.innerHTML = '<main id="m"></main>';
  const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
  const store = createStore({ view: 'graph', graph: { focus_id: focus } });
  const issue_stores = createSubscriptionIssueStores();
  issue_stores.register(GRAPH_CLIENT_ID, graphIssuesSpec());
  let revision = 0;
  /** @param {Row[]} issues */
  const pushSnapshot = (issues) =>
    issue_stores.getStore(GRAPH_CLIENT_ID)?.applyPush({
      type: 'snapshot',
      id: GRAPH_CLIENT_ID,
      revision: ++revision,
      issues
    });
  /** @param {Row} issue */
  const pushUpsert = (issue) =>
    issue_stores.getStore(GRAPH_CLIENT_ID)?.applyPush({
      type: 'upsert',
      id: GRAPH_CLIENT_ID,
      revision: ++revision,
      issue
    });
  pushSnapshot(rows);
  const gotoGraph = vi.fn((/** @type {string | null} */ id) =>
    store.setState({ graph: { focus_id: id } })
  );
  const gotoIssue = vi.fn((/** @type {string} */ id) => id);
  const view = createGraphView({
    mount_element: mount,
    store,
    issue_stores,
    gotoGraph,
    gotoIssue
  });
  view.load();
  if (loaded) {
    view.setLoaded(true);
  }
  return {
    mount,
    store,
    issue_stores,
    view,
    gotoGraph,
    gotoIssue,
    pushSnapshot,
    pushUpsert
  };
}

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement}
 */
function q(root, selector) {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  return el;
}

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
function qa(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter(
    (el) => el instanceof HTMLElement
  );
}

/**
 * SVG edge paths matching a selector.
 *
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {SVGElement[]}
 */
function edges(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter(
    (el) => el instanceof SVGElement
  );
}

/**
 * Text of an element with whitespace collapsed.
 *
 * @param {Element | null} el
 */
function text(el) {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Ids of the plan items in each step, goal row excluded.
 *
 * @param {HTMLElement} mount
 */
function stepIds(mount) {
  return qa(mount, '.graph-step:not(.graph-step--goal)').map((step) =>
    qa(step, '.graph-item').map((li) => li.dataset.id)
  );
}

/**
 * @param {HTMLElement} mount
 * @param {string} id
 */
function node(mount, id) {
  const found = qa(mount, '.graph-node').find((n) => n.dataset.id === id);
  if (!found) {
    throw new Error(`missing node ${id}`);
  }
  return found;
}

/** Let queued store-driven renders run. */
function settle() {
  return Promise.resolve();
}

/**
 * @param {HTMLElement} el
 * @param {string} key
 * @param {KeyboardEventInit} [init]
 */
function press(el, key, init = {}) {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  );
}

describe('views/graph states', () => {
  test('shows a loading status until the subscription is loaded', () => {
    const { mount, view } = setup({ rows: chainRows(), loaded: false });

    expect(text(q(mount, '.graph-state[role="status"]'))).toBe(
      'Loading dependency graph…'
    );

    view.setLoaded(true);

    expect(mount.querySelector('.graph-state[role="status"]')).toBeNull();
  });

  test('shows the error with a Retry button that reloads', () => {
    const { mount, view } = setup({ rows: chainRows(), focus: 'A' });
    const retry = vi.fn();

    view.setError('socket closed', retry);

    const alert = q(mount, '[role="alert"]');
    expect(text(alert)).toContain(
      'Could not load the dependency graph: socket closed'
    );
    q(alert, '.graph-retry').click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(mount.querySelector('[role="alert"]')).toBeNull();
    expect(text(q(mount, '.graph-state[role="status"]'))).toContain('Loading');

    view.setLoaded(true);

    expect(stepIds(mount)).toEqual([['C'], ['B']]);
  });

  test('omits Retry when no retry is given and clears on null', () => {
    const { mount, view } = setup({ rows: chainRows() });

    view.setError('boom');

    expect(mount.querySelector('.graph-retry')).toBeNull();

    view.setError(null);

    expect(mount.querySelector('[role="alert"]')).toBeNull();
  });

  test('suggests where to start when there is no focus', () => {
    const { mount, gotoGraph } = setup({ rows: chainRows() });

    const start = q(mount, '[data-group="start-here"]');
    expect(text(start)).toContain('C Title C');
    expect(text(start)).toContain('unlocks 3 beads');
    expect(text(q(mount, '[data-group="most-blocked"]'))).toContain(
      'waits on 3 beads'
    );

    q(start, 'button[data-id="C"]').click();

    expect(gotoGraph).toHaveBeenCalledWith('C');
    expect(text(q(mount, '.graph-focus__title'))).toBe('C Title C');
  });

  test('says there are no blocking dependencies yet', () => {
    const { mount } = setup({ rows: [row('L1'), row('L2')] });

    expect(text(q(mount, '.graph-state--empty'))).toBe(
      'No blocking dependencies yet.'
    );
  });

  test('reports a focus that is not in this workspace', () => {
    const { mount, gotoGraph } = setup({ rows: chainRows(), focus: 'NOPE' });

    const missing = q(mount, '.graph-state--missing');
    expect(text(missing)).toContain('NOPE was not found in this workspace.');

    q(missing, 'button').click();

    expect(gotoGraph).toHaveBeenCalledWith(null);
    expect(mount.querySelector('.graph-state--missing')).toBeNull();
  });

  test('shows the history of a closed focus with Show closed forced on', () => {
    const { mount } = setup({
      rows: [
        row('K', { status: 'closed' }),
        row('J', { dependencies: [blockedBy('K')] })
      ],
      focus: 'K'
    });

    expect(text(q(mount, '.graph-notice'))).toContain(
      'K is closed. Showing its history'
    );
    const box = /** @type {HTMLInputElement} */ (
      q(mount, '.graph-show-closed')
    );
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(node(mount, 'J').getAttribute('aria-label')).toBe(
      'J: Title J, ready to start, unlocked by the focus'
    );
  });

  test('says when the focus has no edges', () => {
    const { mount } = setup({ rows: [row('L')], focus: 'L' });

    expect(text(q(mount, '.graph-state--no-edges'))).toBe(
      'No dependency edges around L.'
    );
    expect(text(q(mount, '.graph-plan'))).toContain(
      'Nothing has to close first.'
    );
    expect(text(q(mount, '.graph-unlocks'))).toContain('Nothing waits on L.');
    expect(text(q(mount, '.graph-focus__summary'))).toBe('Can start now');
  });

  test('truncates a 150-node slice and says so', () => {
    /** @type {Row[]} */
    const rows = [];
    /** @type {{ id: string, type: string }[]} */
    const focus_deps = [];
    for (let i = 0; i < FAN_OUT; i++) {
      /** @type {{ id: string, type: string }[]} */
      const deps = [];
      for (let j = 0; j < FAN_IN; j++) {
        rows.push(row(`Q${i}-${j}`));
        deps.push(blockedBy(`Q${i}-${j}`));
      }
      rows.push(row(`P${i}`, { dependencies: deps }));
      focus_deps.push(blockedBy(`P${i}`));
    }
    rows.push(row('F', { dependencies: focus_deps }));
    expect(rows.length - 1).toBe(FAN_OUT * (FAN_IN + 1));

    const { mount } = setup({ rows, focus: 'F' });

    const banner = q(mount, '.graph-banner');
    expect(text(banner)).toContain(
      `Showing 1 level around F: the full graph has more than ${MAX_GRAPH_NODES} beads.`
    );
    expect(qa(mount, '.graph-node')).toHaveLength(FAN_OUT + 1);
    expect(stepIds(mount)[1]).toHaveLength(FAN_OUT);
  });
});

describe('views/graph plan pane', () => {
  test('lists numbered steps, then the goal row', () => {
    const { mount } = setup({ rows: chainRows(), focus: 'A' });

    expect(text(q(mount, '#graph-plan-title'))).toBe('Before you can start A');
    expect(stepIds(mount)).toEqual([['C'], ['B']]);
    expect(qa(mount, '.graph-step__title').map((h) => text(h))).toEqual([
      'Step 1',
      'Step 2',
      'Step 3'
    ]);
    expect(
      q(mount, '.graph-item[data-id="C"] .graph-item__focus').getAttribute(
        'aria-label'
      )
    ).toBe('Step 1, item 1 of 1: Title C, ready to start');
    expect(
      q(mount, '.graph-item[data-id="B"] .graph-item__focus').getAttribute(
        'aria-label'
      )
    ).toBe('Step 2, item 1 of 1: Title B, blocked');
    expect(text(q(mount, '.graph-item[data-id="C"] .graph-reasons'))).toBe(
      'blocks B'
    );
    const goal = q(mount, '.graph-goal');
    expect(goal.getAttribute('aria-label')).toBe(
      'Step 3, goal: start Title A, blocked'
    );
    expect(text(goal)).toBe('Blocked Then start A Title A');
    expect(text(q(mount, '[data-group="immediate"]'))).toContain('D Title D');
    expect(text(q(mount, '.graph-focus__summary'))).toBe(
      'Waits on 1 open prerequisite'
    );
  });

  test('numbers items within a step', () => {
    const { mount } = setup({
      rows: [
        row('P1'),
        row('P2'),
        row('T', { dependencies: [blockedBy('P1'), blockedBy('P2')] })
      ],
      focus: 'T'
    });

    expect(
      qa(mount, '.graph-step .graph-item__focus').map((b) =>
        b.getAttribute('aria-label')
      )
    ).toEqual([
      'Step 1, item 1 of 2: Title P1, ready to start',
      'Step 1, item 2 of 2: Title P2, ready to start'
    ]);
  });

  test('names inherited and container reasons', () => {
    const inherited = setup({ rows: containerRows(), focus: 'E1' });
    expect(
      text(q(inherited.mount, '.graph-item[data-id="X"] .graph-reasons'))
    ).toBe('blocks parent E of E1');

    const container = setup({ rows: containerRows(), focus: 'E' });
    expect(text(q(container.mount, '#graph-plan-title'))).toBe(
      'Before you can close E'
    );
    expect(stepIds(container.mount)).toEqual([['X'], ['E1', 'E2']]);
    expect(
      text(q(container.mount, '.graph-item[data-id="E1"] .graph-reasons'))
    ).toBe('part of E');
    expect(text(q(container.mount, '.graph-focus__summary'))).toBe(
      'Waits on 1 open prerequisite; closes after 2 open children'
    );
  });

  test('summarises a startable container', () => {
    const { mount } = setup({
      rows: [row('G', { issue_type: 'epic' }), row('G1', { parent: 'G' })],
      focus: 'G'
    });

    expect(text(q(mount, '.graph-focus__summary'))).toBe(
      'Can start now; closes after 1 open child'
    );
    expect(q(mount, '.graph-focus__summary').getAttribute('aria-live')).toBe(
      'polite'
    );
  });

  test('folds inherited unlocks behind a disclosure', () => {
    const { mount } = setup({ rows: containerRows(), focus: 'X' });

    const immediate = q(mount, '[data-group="immediate"]');
    expect(
      qa(immediate, ':scope > .graph-item').map((li) => li.dataset.id)
    ).toEqual(['E']);
    const toggle = q(immediate, '.graph-fold');
    const list = q(mount, `#${toggle.getAttribute('aria-controls')}`);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text(toggle)).toBe('Show 2 beads inside E');
    expect(list.hidden).toBe(true);

    toggle.click();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(toggle)).toBe('Hide 2 beads inside E');
    expect(list.hidden).toBe(false);
    expect(qa(list, '.graph-item').map((li) => li.dataset.id)).toEqual([
      'E1',
      'E2'
    ]);
  });

  test('lists later waves and what is still waiting', () => {
    const { mount } = setup({
      rows: [
        row('S'),
        row('W1', { dependencies: [blockedBy('S')] }),
        row('W2', { dependencies: [blockedBy('W1')] }),
        row('O1'),
        row('O2'),
        row('O3'),
        row('V', {
          dependencies: [
            blockedBy('S'),
            blockedBy('O1'),
            blockedBy('O2'),
            blockedBy('O3')
          ]
        })
      ],
      focus: 'S'
    });

    expect(text(q(mount, '[data-group="immediate"]'))).toContain('W1');
    expect(text(q(mount, '[data-group="later"]'))).toContain('W2');
    expect(text(q(mount, '[data-group="still-waiting"]'))).toContain(
      '(also needs O1, O2 and 1 more)'
    );
  });

  test('lists related beads apart from the order', () => {
    const { mount } = setup({
      rows: [row('R', { dependencies: [relatedTo('S')] }), row('S')],
      focus: 'R'
    });

    const related = q(mount, '.graph-related');
    expect(text(q(related, 'h3'))).toBe('Related (does not affect order)');
    expect(text(q(related, '.graph-item[data-id="S"]'))).toContain(
      'related S Title S'
    );
    expect(text(q(mount, '.graph-plan'))).toContain(
      'Nothing has to close first.'
    );
  });

  test('a live upsert that closes a blocker moves the next item into Step 1', async () => {
    const { mount, pushUpsert } = setup({ rows: chainRows(), focus: 'A' });
    expect(stepIds(mount)).toEqual([['C'], ['B']]);

    pushUpsert(row('C', { status: 'closed' }));
    await settle();

    expect(stepIds(mount)).toEqual([['B']]);
    expect(
      q(mount, '.graph-item[data-id="B"] .graph-item__focus').getAttribute(
        'aria-label'
      )
    ).toBe('Step 1, item 1 of 1: Title B, ready to start');
  });

  test('flags a cycle in the plan and on the canvas', () => {
    const { mount } = setup({
      rows: [
        row('P', { dependencies: [blockedBy('Q')] }),
        row('Q', { dependencies: [blockedBy('P')] })
      ],
      focus: 'P'
    });

    expect(text(q(mount, '.graph-plan .graph-notice'))).toContain(
      'A dependency cycle runs through this plan'
    );
    expect(text(q(mount, '.graph-focus__summary'))).toBe(
      'Stuck in a dependency cycle'
    );
    expect(edges(mount, 'path.graph-edge.is-cycle').length).toBeGreaterThan(0);
  });

  test('breadcrumbs refocus and Open details opens the dialog', () => {
    const { mount, gotoGraph, gotoIssue } = setup({
      rows: containerRows(),
      focus: 'E1'
    });

    q(mount, '.graph-open-details').click();
    expect(gotoIssue).toHaveBeenCalledWith('E1');

    q(mount, '.graph-crumbs button[data-id="E"]').click();
    expect(gotoGraph).toHaveBeenCalledWith('E');
    expect(text(q(mount, '.graph-focus__title'))).toBe('E Title E');
  });
});

describe('views/graph graph pane', () => {
  test('draws columns and labels each node with its state', () => {
    const { mount } = setup({ rows: chainRows(), focus: 'A' });

    expect(qa(mount, '.graph-column-head').map((h) => text(h))).toEqual([
      'Prerequisites',
      'Focus',
      'Unlocks'
    ]);
    expect(node(mount, 'A').getAttribute('aria-label')).toBe(
      'A: Title A, blocked, current focus'
    );
    expect(node(mount, 'C').getAttribute('aria-label')).toBe(
      'C: Title C, ready to start, prerequisite'
    );
    expect(text(q(node(mount, 'C'), '.graph-state-chip'))).toBe('Ready');
    expect(edges(mount, 'path.graph-edge--blocks')).toHaveLength(3);
  });

  test('spells out the status of an unblocked bead bd ready excludes', () => {
    const { mount } = setup({
      rows: [
        row('H', { status: 'in_progress' }),
        row('T', { dependencies: [blockedBy('H')] })
      ],
      focus: 'T'
    });

    expect(node(mount, 'H').getAttribute('aria-label')).toBe(
      'H: Title H, unblocked, status in progress, prerequisite'
    );
  });

  test('the depth control limits the slice', () => {
    const { mount } = setup({ rows: chainRows(), focus: 'A' });
    expect(qa(mount, '.graph-node').map((n) => n.dataset.id)).toContain('C');

    const select = /** @type {HTMLSelectElement} */ (q(mount, '.graph-depth'));
    select.value = '1';
    select.dispatchEvent(new Event('change'));

    expect(
      qa(mount, '.graph-node')
        .map((n) => n.dataset.id)
        .sort()
    ).toEqual(['A', 'B', 'D']);
  });

  test('a fold chip expands the folded children onto the canvas', () => {
    const { mount } = setup({ rows: containerRows(), focus: 'X' });
    expect(
      qa(mount, '.graph-node')
        .map((n) => n.dataset.id)
        .sort()
    ).toEqual(['E', 'X']);
    expect(node(mount, 'E').getAttribute('aria-label')).toBe(
      'E: Title E, blocked, unlocked by the focus, 2 beads folded inside'
    );

    const chip = q(mount, '.graph-fold-chip[data-id="E"]');
    expect(text(chip)).toBe('+2');
    chip.focus();
    chip.click();

    expect(
      qa(mount, '.graph-node')
        .map((n) => n.dataset.id)
        .sort()
    ).toEqual(['E', 'E1', 'E2', 'X']);
    expect(mount.querySelector('.graph-fold-chip')).toBeNull();
    expect(document.activeElement).toBe(node(mount, 'E'));
    expect(node(mount, 'E').getAttribute('tabindex')).toBe('0');
    expect(node(mount, 'X').getAttribute('tabindex')).toBe('-1');
  });

  test('hovering a node highlights its edges', () => {
    const { mount } = setup({ rows: chainRows(), focus: 'A' });

    node(mount, 'B').dispatchEvent(new MouseEvent('mouseenter'));

    const lit = edges(mount, 'path.graph-edge.is-highlighted').map(
      (p) => `${p.dataset.from}>${p.dataset.to}`
    );
    expect(lit.sort()).toEqual(['B>A', 'C>B']);
    expect(q(mount, '.graph-canvas').classList.contains('has-highlight')).toBe(
      true
    );

    node(mount, 'B').dispatchEvent(new MouseEvent('mouseleave'));

    expect(mount.querySelector('path.is-highlighted')).toBeNull();
  });

  test('roving tabindex: arrows move, Home returns, Enter refocuses', () => {
    const { mount, gotoGraph, gotoIssue } = setup({
      rows: chainRows(),
      focus: 'A'
    });
    /** @param {string} id */
    const tabindex = (id) => node(mount, id).getAttribute('tabindex');
    expect(tabindex('A')).toBe('0');
    expect(tabindex('B')).toBe('-1');

    press(node(mount, 'A'), 'ArrowLeft');
    expect(tabindex('B')).toBe('0');
    expect(tabindex('A')).toBe('-1');
    expect(document.activeElement).toBe(node(mount, 'B'));

    press(node(mount, 'B'), 'ArrowLeft');
    expect(document.activeElement).toBe(node(mount, 'C'));
    press(node(mount, 'C'), 'ArrowUp');
    expect(document.activeElement).toBe(node(mount, 'C'));

    press(node(mount, 'C'), 'Home');
    expect(document.activeElement).toBe(node(mount, 'A'));
    press(node(mount, 'A'), 'ArrowRight');
    expect(document.activeElement).toBe(node(mount, 'D'));

    press(node(mount, 'D'), 'o');
    expect(gotoIssue).toHaveBeenLastCalledWith('D');
    press(node(mount, 'D'), 'Enter', { shiftKey: true });
    expect(gotoIssue).toHaveBeenCalledTimes(2);
    expect(gotoGraph).not.toHaveBeenCalled();

    press(node(mount, 'D'), 'Enter');
    expect(gotoGraph).toHaveBeenCalledWith('D');
    expect(text(q(mount, '.graph-focus__title'))).toBe('D Title D');
    expect(node(mount, 'D').getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(node(mount, 'D'));
  });

  test('Enter moves DOM focus to the refocused node, not the reused button', () => {
    const { mount } = setup({ rows: refocusRows(), focus: 'A' });
    expect(qa(mount, '.graph-node').map((n) => n.dataset.id)).toEqual([
      'C',
      'Y',
      'B',
      'X',
      'A',
      'D'
    ]);

    node(mount, 'Y').focus();
    press(node(mount, 'Y'), 'Enter');

    expect(text(q(mount, '.graph-focus__title'))).toBe('Y Title Y');
    expect(document.activeElement).toBe(node(mount, 'Y'));
    expect(node(mount, 'Y').getAttribute('tabindex')).toBe('0');
  });

  test('Enter moves DOM focus once an asynchronous route change renders', async () => {
    const { mount, store, gotoGraph } = setup({
      rows: refocusRows(),
      focus: 'A'
    });
    gotoGraph.mockImplementation((id) =>
      queueMicrotask(() => store.setState({ graph: { focus_id: id } }))
    );

    node(mount, 'Y').focus();
    press(node(mount, 'Y'), 'Enter');
    expect(text(q(mount, '.graph-focus__title'))).toBe('A Title A');

    await settle();

    expect(text(q(mount, '.graph-focus__title'))).toBe('Y Title Y');
    expect(document.activeElement).toBe(node(mount, 'Y'));
  });

  test('draws the legend with named line patterns', () => {
    const { mount } = setup({ rows: chainRows(), focus: 'A' });

    expect(qa(mount, '.graph-legend__item').map((li) => text(li))).toEqual([
      'Blocks (solid line)',
      'Inherited from a parent (dashed line)',
      'Part of a container (dotted line)',
      'Related, no order (thin line)',
      'Cycle (red, barred arrow)'
    ]);
  });
});

describe('views/graph toolbar', () => {
  test('the bead picker is a combobox that refocuses on Enter', () => {
    const { mount, gotoGraph } = setup({ rows: chainRows() });
    const input = /** @type {HTMLInputElement} */ (
      q(mount, 'input[role="combobox"]')
    );
    const list = q(mount, '[role="listbox"]');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(list.hidden).toBe(true);

    input.value = 'title b';
    input.dispatchEvent(new Event('input'));

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect(qa(list, '[role="option"]').map((o) => o.dataset.id)).toEqual(['B']);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);

    press(input, 'ArrowDown');

    const option = q(list, '[role="option"]');
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('aria-selected')).toBe('true');

    press(input, 'Enter');

    expect(gotoGraph).toHaveBeenCalledWith('B');
    expect(input.value).toBe('');
    expect(list.hidden).toBe(true);
    expect(text(q(mount, '.graph-focus__title'))).toBe('B Title B');
  });

  test('Escape closes the picker list, then clears the query', () => {
    const { mount } = setup({ rows: chainRows() });
    const input = /** @type {HTMLInputElement} */ (
      q(mount, 'input[role="combobox"]')
    );
    input.value = 'C';
    input.dispatchEvent(new Event('input'));
    expect(input.getAttribute('aria-expanded')).toBe('true');

    press(input, 'Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('C');

    press(input, 'Escape');
    expect(input.value).toBe('');
  });

  test('clicking an option refocuses and Clear focus clears it', () => {
    const { mount, gotoGraph } = setup({ rows: chainRows() });
    const input = /** @type {HTMLInputElement} */ (
      q(mount, 'input[role="combobox"]')
    );
    const clear = /** @type {HTMLButtonElement} */ (q(mount, '.graph-clear'));
    expect(clear.disabled).toBe(true);
    input.value = 'D';
    input.dispatchEvent(new Event('input'));

    q(mount, '[role="option"][data-id="D"]').click();

    expect(gotoGraph).toHaveBeenLastCalledWith('D');
    expect(clear.disabled).toBe(false);

    clear.click();

    expect(gotoGraph).toHaveBeenLastCalledWith(null);
    expect(mount.querySelector('.graph-focus')).toBeNull();
  });
});

describe('views/graph lifecycle', () => {
  test('rebuilds the index only when the graph store changes', async () => {
    const { mount, issue_stores, pushUpsert } = setup({
      rows: chainRows(),
      focus: 'A'
    });
    const builds = () => vi.mocked(buildDepIndex).mock.calls.length;
    const before = builds();

    issue_stores.register('tab:other', { type: 'all-issues' });
    issue_stores.getStore('tab:other')?.applyPush({
      type: 'snapshot',
      id: 'tab:other',
      revision: 1,
      issues: [row('Z')]
    });
    node(mount, 'B').dispatchEvent(new MouseEvent('mouseenter'));

    expect(builds()).toBe(before);

    pushUpsert(row('C', { title: 'Renamed C' }));
    await settle();

    expect(builds()).toBe(before + 1);
    expect(text(q(mount, '.graph-item[data-id="C"]'))).toContain('Renamed C');
  });

  test('a burst of upserts in one task builds the index and suggestions once', async () => {
    const { mount, pushUpsert } = setup({ rows: chainRows() });
    const builds = () => vi.mocked(buildDepIndex).mock.calls.length;
    const passes = () => vi.mocked(computeSuggestions).mock.calls.length;
    const builds_before = builds();
    const passes_before = passes();

    for (let i = 1; i <= BURST_SIZE; i++) {
      pushUpsert(row('C', { title: `Renamed C ${i}` }));
    }
    expect(builds()).toBe(builds_before);

    await settle();

    expect(builds()).toBe(builds_before + 1);
    expect(passes()).toBe(passes_before + 1);
    expect(text(q(mount, '[data-group="start-here"]'))).toContain(
      `Renamed C ${BURST_SIZE}`
    );
  });

  test('destroy empties the mount and stops listening', () => {
    const { mount, view, store, pushSnapshot } = setup({
      rows: chainRows(),
      focus: 'A'
    });
    expect(mount.querySelector('.graph-view')).not.toBeNull();

    view.destroy();

    expect(mount.querySelector('.graph-view')).toBeNull();
    pushSnapshot([row('N')]);
    store.setState({ graph: { focus_id: 'N' } });
    view.setLoaded(true);
    view.load();
    expect(mount.querySelector('.graph-view')).toBeNull();
    expect(text(mount)).toBe('');
  });
});
