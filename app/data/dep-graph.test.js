import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  MAX_COLUMN_NODES,
  MAX_GRAPH_NODES,
  ORDERING_DEP_TYPES,
  START_STATUSES,
  ancestorIds,
  buildDepIndex,
  canClose,
  canStart,
  collectGraphSlice,
  computeSuggestions,
  computeUnlocks,
  computeWorkOrder,
  deriveBdBlocked,
  deriveBdReadyIds,
  descendantIds,
  findCycles,
  hasOrderingRelations,
  nodeState,
  searchFocusCandidates
} from './dep-graph.js';
import {
  BOARD_INDEX_CLIENT_ID,
  GRAPH_CLIENT_ID,
  GRAPH_ISSUES_TYPE,
  graphIssuesSpec
} from './graph-subscription.js';

/**
 * @typedef {import('./dep-graph.js').DepIssue} DepIssue
 */

/** The bd 0.63.3 ready/blocked capture, relative to this file. */
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/fixtures/bd-ready-parity.json'
);
/** Seeds for the deterministic shuffles and random graphs. */
const SHUFFLE_SEEDS = [1, 7, 42, 1234, 99991];
/** Number of beads in each random graph of the inverse property test. */
const RANDOM_GRAPH_SIZE = 40;
/** Chance that a random bead gets a parent, and that a pair gets an edge. */
const RANDOM_PARENT_CHANCE = 0.4;
const RANDOM_EDGE_CHANCE = 0.06;
const RANDOM_CLOSED_CHANCE = 0.2;
/** Length of the chain that proves the walks are iterative. */
const DEEP_CHAIN_LENGTH = 5000;
/** mulberry32 constants. */
const PRNG_INCREMENT = 0x6d2b79f5;
const PRNG_SHIFT_A = 15;
const PRNG_SHIFT_B = 7;
const PRNG_SHIFT_C = 14;
const PRNG_OR_A = 1;
const PRNG_OR_B = 61;
const UINT32_RANGE = 4294967296;

/**
 * Seeded mulberry32 generator in [0, 1).
 *
 * @param {number} seed
 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + PRNG_INCREMENT) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> PRNG_SHIFT_A), t | PRNG_OR_A);
    t ^= t + Math.imul(t ^ (t >>> PRNG_SHIFT_B), t | PRNG_OR_B);
    return ((t ^ (t >>> PRNG_SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * Fisher-Yates shuffle of a copy, also shuffling each row's edge list.
 *
 * @param {DepIssue[]} rows
 * @param {number} seed
 * @returns {DepIssue[]}
 */
function shuffled(rows, seed) {
  const rand = prng(seed);
  /**
   * @template T
   * @param {T[]} list
   * @returns {T[]}
   */
  const mix = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return mix(rows).map((r) =>
    r.dependencies ? { ...r, dependencies: mix(r.dependencies) } : { ...r }
  );
}

/**
 * Build a row. `blocks` and `related` name the targets of this row's edges.
 *
 * @param {string} id
 * @param {{ status?: string, priority?: number, parent?: string, blocks?: string[], related?: string[], title?: string, labels?: string[] }} [opts]
 * @returns {DepIssue}
 */
function row(id, opts = {}) {
  /** @type {Array<{ depends_on_id: string, type: string }>} */
  const dependencies = [];
  for (const b of opts.blocks ?? []) {
    dependencies.push({ depends_on_id: b, type: 'blocks' });
  }
  for (const r of opts.related ?? []) {
    dependencies.push({ depends_on_id: r, type: 'related' });
  }
  if (opts.parent) {
    dependencies.push({ depends_on_id: opts.parent, type: 'parent-child' });
  }
  return {
    id,
    title: opts.title ?? `Title ${id}`,
    status: opts.status ?? 'open',
    priority: opts.priority ?? 2,
    issue_type: 'task',
    ...(opts.parent ? { parent: opts.parent } : {}),
    ...(opts.labels ? { labels: opts.labels } : {}),
    dependencies
  };
}

/**
 * Ids of every step, for compact assertions.
 *
 * @param {import('./dep-graph.js').WorkOrder} order
 */
function stepIds(order) {
  return order.steps.map((s) => s.items.map((i) => i.id));
}

/**
 * @param {import('./dep-graph.js').GraphSlice} slice
 */
function columns(slice) {
  return Object.fromEntries(slice.nodes.map((n) => [n.id, n.column]));
}

/**
 * Random graph rows for the property tests.
 *
 * @param {number} seed
 * @returns {DepIssue[]}
 */
function randomRows(seed) {
  const rand = prng(seed);
  const ids = Array.from({ length: RANDOM_GRAPH_SIZE }, (_, i) => `r-${i}`);
  return ids.map((id, i) => {
    const parent =
      i > 0 && rand() < RANDOM_PARENT_CHANCE
        ? ids[Math.floor(rand() * i)]
        : undefined;
    const blocks = ids.filter(
      (other) => other !== id && rand() < RANDOM_EDGE_CHANCE
    );
    if (rand() < RANDOM_EDGE_CHANCE) {
      blocks.push(`ext-${i}`);
    }
    return row(id, {
      parent,
      blocks,
      status: rand() < RANDOM_CLOSED_CHANCE ? 'closed' : 'open'
    });
  });
}

describe('buildDepIndex', () => {
  test('inherits blockers through four levels with the right via', () => {
    const index = buildDepIndex([
      row('b0'),
      row('b1'),
      row('b3'),
      row('l0', { blocks: ['b0'] }),
      row('l1', { parent: 'l0', blocks: ['b1'] }),
      row('l2', { parent: 'l1' }),
      row('l3', { parent: 'l2', blocks: ['b3'] })
    ]);
    expect(index.prereqs_of.get('l3')).toEqual([
      { id: 'b0', reason: 'inherited', via: 'l0' },
      { id: 'b1', reason: 'inherited', via: 'l1' },
      { id: 'b3', reason: 'blocks', via: null }
    ]);
    expect(index.prereqs_of.get('l0')).toEqual([
      { id: 'b0', reason: 'blocks', via: null },
      { id: 'l1', reason: 'child', via: null }
    ]);
    expect(ancestorIds(index, 'l3')).toEqual(['l2', 'l1', 'l0']);
    expect(descendantIds(index, 'l0')).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(descendantIds(index, 'missing')).toEqual(['missing']);
  });

  test('merges parent-child edges with the parent field', () => {
    const index = buildDepIndex([
      row('ep'),
      { id: 'a', status: 'open', parent: 'ep' },
      {
        id: 'b',
        status: 'open',
        dependencies: [{ depends_on_id: 'ep', type: 'parent-child' }]
      }
    ]);
    expect(index.entries.get('ep')?.children).toEqual(['a', 'b']);
    expect(index.entries.get('b')?.parent).toBe('ep');
  });

  test('keeps one entry per prerequisite with blocks over inherited over child', () => {
    const index = buildDepIndex([
      row('p', { blocks: ['x', 'y'] }),
      row('t', { parent: 'p', blocks: ['x'] }),
      row('x'),
      row('y'),
      row('c', { parent: 't' }),
      row('d', { parent: 't', blocks: ['t'] })
    ]);
    expect(index.prereqs_of.get('t')).toEqual([
      { id: 'c', reason: 'child', via: null },
      { id: 'd', reason: 'child', via: null },
      { id: 'x', reason: 'blocks', via: null },
      { id: 'y', reason: 'inherited', via: 'p' }
    ]);
    const child_and_blocker = buildDepIndex([
      row('e', { blocks: ['k'] }),
      row('k', { parent: 'e' })
    ]);
    expect(child_and_blocker.prereqs_of.get('e')).toEqual([
      { id: 'k', reason: 'blocks', via: null }
    ]);
  });

  test('skips closed prerequisites and keeps context edges as related', () => {
    const index = buildDepIndex([
      row('done', { status: 'closed' }),
      row('a', { blocks: ['done'], related: ['b'] }),
      row('b')
    ]);
    expect(index.prereqs_of.get('a')).toEqual([]);
    expect(index.entries.get('a')?.blockers).toEqual(['done']);
    expect(index.entries.get('a')?.related).toEqual([
      { id: 'b', type: 'related', direction: 'out' }
    ]);
    expect(index.entries.get('b')?.related).toEqual([
      { id: 'a', type: 'related', direction: 'in' }
    ]);
  });

  test('treats a pinned bead as done, like bd ready', () => {
    const index = buildDepIndex([
      row('pin', { status: 'pinned', blocks: ['b'] }),
      row('b'),
      row('x', { blocks: ['pin'] })
    ]);
    expect(index.prereqs_of.get('x')).toEqual([]);
    expect(index.prereqs_of.get('pin')).toEqual([]);
    expect(canStart(index, 'x')).toBe(true);
    expect(nodeState(index, 'x')).toBe('ready');
    expect(nodeState(index, 'pin')).toBe('held');
    expect(computeWorkOrder(index, 'x').steps).toEqual([]);
    expect(computeSuggestions(index).most_blocked).toEqual([]);
    expect(columns(collectGraphSlice(index, 'x'))).toEqual({ x: 0 });
    expect(
      columns(collectGraphSlice(index, 'x', { include_closed: true }))
    ).toEqual({ pin: -1, x: 0 });
  });

  test('treats unknown ids as external and never expands them', () => {
    const index = buildDepIndex([
      row('a', { blocks: ['external:proj:cap'] }),
      row('b', { parent: 'gone' })
    ]);
    expect(index.external_ids).toEqual(['external:proj:cap', 'gone']);
    expect(index.prereqs_of.get('a')).toEqual([
      { id: 'external:proj:cap', reason: 'blocks', via: null }
    ]);
    expect(index.unlocks_of.get('external:proj:cap')).toEqual([
      { id: 'a', reason: 'blocks', via: null }
    ]);
    expect(canStart(index, 'a')).toBe(true);
    expect(nodeState(index, 'external:proj:cap')).toBe('external');
    expect(ancestorIds(index, 'b')).toEqual(['gone']);
    const order = computeWorkOrder(index, 'a');
    expect(stepIds(order)).toEqual([['external:proj:cap']]);
    expect(order.steps[0].items[0].state).toBe('external');
  });

  test('unions edges and labels of duplicate rows', () => {
    const index = buildDepIndex([
      row('a', { blocks: ['b'], labels: ['x'] }),
      row('b'),
      { id: 'a', status: 'open', labels: ['y'] }
    ]);
    expect(index.entries.get('a')?.blockers).toEqual(['b']);
    expect(index.entries.get('a')?.issue.labels).toEqual(['x', 'y']);
  });

  test('unlocks_of is the exact inverse of prereqs_of', () => {
    for (const seed of SHUFFLE_SEEDS) {
      const index = buildDepIndex(randomRows(seed));
      /** @type {string[]} */
      const forward = [];
      for (const [x, links] of index.prereqs_of) {
        for (const l of links) {
          forward.push(`${l.id}>${x}:${l.reason}:${l.via}`);
        }
      }
      /** @type {string[]} */
      const backward = [];
      for (const [p, links] of index.unlocks_of) {
        for (const l of links) {
          backward.push(`${p}>${l.id}:${l.reason}:${l.via}`);
        }
      }
      expect(forward.length).toBeGreaterThan(0);
      expect(backward.sort()).toEqual(forward.sort());
    }
  });

  test('gives the same output for shuffled input', () => {
    for (const seed of SHUFFLE_SEEDS) {
      const rows = randomRows(seed);
      const base = buildDepIndex(rows);
      const focus = 'r-5';
      for (const other_seed of SHUFFLE_SEEDS) {
        const again = buildDepIndex(shuffled(rows, other_seed));
        expect(again.ids).toEqual(base.ids);
        expect(again.prereqs_of).toEqual(base.prereqs_of);
        expect(again.unlocks_of).toEqual(base.unlocks_of);
        expect(findCycles(again)).toEqual(findCycles(base));
        expect(again.cycle_ids).toEqual(base.cycle_ids);
        expect(computeWorkOrder(again, focus)).toEqual(
          computeWorkOrder(base, focus)
        );
        expect(computeUnlocks(again, focus)).toEqual(
          computeUnlocks(base, focus)
        );
        expect(computeSuggestions(again)).toEqual(computeSuggestions(base));
        expect(collectGraphSlice(again, focus)).toEqual(
          collectGraphSlice(base, focus)
        );
      }
    }
  });

  test('walks a very deep chain without recursion', () => {
    /** @type {DepIssue[]} */
    const rows = [];
    for (let i = 0; i < DEEP_CHAIN_LENGTH; i++) {
      rows.push(row(`n${i}`, i > 0 ? { blocks: [`n${i - 1}`] } : {}));
    }
    rows.push(row('loop', { blocks: [`n${DEEP_CHAIN_LENGTH - 1}`] }));
    rows[0] = row('n0', { blocks: ['loop'] });
    const index = buildDepIndex(rows);
    expect(findCycles(index)).toHaveLength(1);
    expect(findCycles(index)[0]).toHaveLength(DEEP_CHAIN_LENGTH + 1);
    const order = computeWorkOrder(index, `n${DEEP_CHAIN_LENGTH - 1}`);
    expect(order.total).toBe(DEEP_CHAIN_LENGTH);
  });
});

describe('canStart and canClose', () => {
  test('separates starting from closing a container', () => {
    const index = buildDepIndex([
      row('ep'),
      row('t1', { parent: 'ep' }),
      row('t2', { parent: 'ep', status: 'closed' }),
      row('solo')
    ]);
    expect(canStart(index, 'ep')).toBe(true);
    expect(canClose(index, 'ep')).toBe(false);
    expect(canStart(index, 'solo')).toBe(true);
    expect(canClose(index, 'solo')).toBe(true);
    expect(canStart(index, 'missing')).toBe(false);
  });

  test('requires a status bd ready admits and no open blocker', () => {
    expect(START_STATUSES).toEqual(['open']);
    const index = buildDepIndex([
      row('wip', { status: 'in_progress' }),
      row('rev', { status: 'in_review' }),
      row('def', { status: 'deferred' }),
      row('blk', { status: 'blocked' }),
      row('done', { status: 'closed' }),
      row('waits', { blocks: ['wip'] }),
      row('kid', { parent: 'waits' })
    ]);
    for (const id of ['wip', 'rev', 'def', 'blk', 'done', 'waits', 'kid']) {
      expect(canStart(index, id)).toBe(false);
      expect(canClose(index, id)).toBe(false);
    }
    expect(nodeState(index, 'wip')).toBe('held');
    expect(nodeState(index, 'done')).toBe('closed');
    expect(nodeState(index, 'waits')).toBe('blocked');
    expect(nodeState(index, 'kid')).toBe('blocked');
  });
});

describe('computeWorkOrder', () => {
  test('orders a chain', () => {
    const index = buildDepIndex([
      row('a'),
      row('b', { blocks: ['a'] }),
      row('c', { blocks: ['b'] })
    ]);
    const order = computeWorkOrder(index, 'c');
    expect(stepIds(order)).toEqual([['a'], ['b']]);
    expect(order.goal).toBe('start');
    expect(order.goal_step).toBe(3);
    expect(order.goal_state).toBe('blocked');
    expect(order.steps[0].items[0]).toEqual({
      id: 'a',
      state: 'ready',
      reasons: [{ id: 'b', reason: 'blocks', via: null }]
    });
  });

  test('layers a diamond by longest path', () => {
    const index = buildDepIndex([
      row('a'),
      row('b', { blocks: ['a'] }),
      row('c', { blocks: ['a'], priority: 0 }),
      row('d', { blocks: ['b', 'c', 'a'] })
    ]);
    const order = computeWorkOrder(index, 'd');
    expect(stepIds(order)).toEqual([['a'], ['c', 'b']]);
    expect(order.total).toBe(3);
  });

  test('closes a container blocker before starting', () => {
    const index = buildDepIndex([
      row('ep'),
      row('k1', { parent: 'ep' }),
      row('k2', { parent: 'ep' }),
      row('t', { blocks: ['ep'] })
    ]);
    const order = computeWorkOrder(index, 't');
    expect(stepIds(order)).toEqual([['k1', 'k2'], ['ep']]);
    expect(order.steps[0].items[0].reasons).toEqual([
      { id: 'ep', reason: 'child', via: null }
    ]);
    expect(order.goal).toBe('start');
  });

  test('closes a container focus after its children', () => {
    const index = buildDepIndex([
      row('x'),
      row('ep'),
      row('k1', { parent: 'ep', blocks: ['x'] }),
      row('k2', { parent: 'ep' })
    ]);
    const close = computeWorkOrder(index, 'ep');
    expect(close.goal).toBe('close');
    expect(stepIds(close)).toEqual([['k2', 'x'], ['k1']]);
    const start = computeWorkOrder(index, 'ep', { goal: 'start' });
    expect(start.steps).toEqual([]);
    expect(start.goal_step).toBe(1);
    expect(start.goal_state).toBe('ready');
  });
});

describe('cycles', () => {
  test('marks a 2-cycle and everything downstream', () => {
    const index = buildDepIndex([
      row('x', { blocks: ['y'] }),
      row('y', { blocks: ['x'] }),
      row('z', { blocks: ['x'] }),
      row('free')
    ]);
    expect(findCycles(index)).toEqual([['x', 'y']]);
    expect(Array.from(index.cycle_ids).sort()).toEqual(['x', 'y', 'z']);
    expect(nodeState(index, 'z')).toBe('cycle');
    expect(nodeState(index, 'free')).toBe('ready');
    const order = computeWorkOrder(index, 'z');
    expect(order.has_cycle).toBe(true);
    expect(stepIds(order)).toEqual([['x', 'y']]);
    const slice = collectGraphSlice(index, 'x');
    const xy = slice.edges.find((e) => e.from === 'y' && e.to === 'x');
    expect(xy?.cycle).toBe(true);
    const xz = slice.edges.find((e) => e.from === 'x' && e.to === 'z');
    expect(xz?.cycle).toBe(false);
  });

  test('marks a child blocking its own parent as a self-loop', () => {
    const index = buildDepIndex([
      row('p', { blocks: ['c'] }),
      row('c', { parent: 'p' })
    ]);
    expect(index.prereqs_of.get('c')).toEqual([
      { id: 'c', reason: 'inherited', via: 'p' }
    ]);
    expect(findCycles(index)).toEqual([['c']]);
    expect(Array.from(index.cycle_ids).sort()).toEqual(['c', 'p']);
    expect(canStart(index, 'c')).toBe(false);
  });
});

describe('computeUnlocks', () => {
  test('reports waves, still waiting and folded children', () => {
    const index = buildDepIndex([
      row('f'),
      row('other'),
      row('ep', { blocks: ['f'] }),
      row('k1', { parent: 'ep' }),
      row('k2', { parent: 'ep' }),
      row('k3', { parent: 'ep', blocks: ['other'] }),
      row('next', { blocks: ['ep'] }),
      row('pair', { blocks: ['f', 'other'] }),
      row('t', { parent: 'up' }),
      row('up'),
      row('g', { blocks: ['f'], parent: 'up' })
    ]);
    const unlocks = computeUnlocks(index, 'f');
    expect(unlocks.immediate).toEqual([
      {
        id: 'ep',
        reasons: [{ id: 'f', reason: 'blocks', via: null }],
        folded: ['k1', 'k2']
      },
      {
        id: 'g',
        reasons: [{ id: 'f', reason: 'blocks', via: null }],
        folded: []
      }
    ]);
    expect(unlocks.waves).toEqual([]);
    expect(unlocks.still_waiting).toEqual([
      { id: 'k3', waits_on: ['other'] },
      { id: 'next', waits_on: ['ep'] },
      { id: 'pair', waits_on: ['other'] },
      { id: 'up', waits_on: ['t'] }
    ]);
    expect(unlocks.total).toBe(4);
  });

  test('chains later waves after the immediate ones', () => {
    const index = buildDepIndex([
      row('a'),
      row('b', { blocks: ['a'] }),
      row('c', { blocks: ['b'] }),
      row('d', { blocks: ['c'] })
    ]);
    const unlocks = computeUnlocks(index, 'a');
    expect(unlocks.immediate.map((g) => g.id)).toEqual(['b']);
    expect(unlocks.waves.map((w) => w.map((g) => g.id))).toEqual([
      ['c'],
      ['d']
    ]);
    expect(unlocks.still_waiting).toEqual([]);
  });
});

describe('computeSuggestions', () => {
  test('ranks start-here by downstream size and most blocked by upstream', () => {
    const index = buildDepIndex([
      row('root'),
      row('mid', { blocks: ['root'] }),
      row('leaf', { blocks: ['mid'] }),
      row('side', { priority: 0 }),
      row('dep', { blocks: ['side'] }),
      row('lonely')
    ]);
    expect(computeSuggestions(index)).toEqual({
      start_here: [
        { id: 'root', downstream: 2 },
        { id: 'side', downstream: 1 }
      ],
      most_blocked: [
        { id: 'leaf', upstream: 2 },
        { id: 'dep', upstream: 1 },
        { id: 'mid', upstream: 1 }
      ]
    });
    expect(computeSuggestions(index, { limit: 1 }).start_here).toEqual([
      { id: 'root', downstream: 2 }
    ]);
  });
});

describe('collectGraphSlice', () => {
  const chain = [
    row('a'),
    row('b', { blocks: ['a'] }),
    row('c', { blocks: ['b'] }),
    row('d', { blocks: ['c'] }),
    row('e', { blocks: ['d'] })
  ];

  test('limits the depth on both sides', () => {
    const index = buildDepIndex(chain);
    const slice = collectGraphSlice(index, 'c', { max_depth: 1 });
    expect(columns(slice)).toEqual({ b: -1, c: 0, d: 1 });
    expect(slice.truncated).toBe(false);
    const all = collectGraphSlice(index, 'c');
    expect(columns(all)).toEqual({ a: -2, b: -1, c: 0, d: 1, e: 2 });
    expect(all.reached_depth).toBe(2);
    expect(all.nodes.find((n) => n.id === 'c')?.focus).toBe(true);
  });

  test('lowers the depth when the slice is too large', () => {
    /** @type {DepIssue[]} */
    const rows = [row('f')];
    for (let i = 0; i < MAX_COLUMN_NODES; i++) {
      rows.push(row(`m${i}`, { blocks: ['f'] }));
      for (let j = 0; j < 3; j++) {
        rows.push(row(`m${i}-${j}`, { blocks: [`m${i}`] }));
      }
    }
    const index = buildDepIndex(rows);
    const slice = collectGraphSlice(index, 'f');
    expect(slice.truncated).toBe(true);
    expect(slice.depth).toBe(1);
    expect(slice.nodes.length).toBeLessThanOrEqual(MAX_GRAPH_NODES);
    expect(slice.nodes.length).toBe(MAX_COLUMN_NODES + 1);
  });

  test('caps each depth-1 column and reports the overflow', () => {
    const extra = 3;
    /** @type {DepIssue[]} */
    const rows = [row('f')];
    for (let i = 0; i < MAX_COLUMN_NODES + extra; i++) {
      const id = `u${String(i).padStart(2, '0')}`;
      rows.push(row(id, { blocks: ['f'], priority: i < extra ? 4 : 1 }));
    }
    const index = buildDepIndex(rows);
    const slice = collectGraphSlice(index, 'f');
    expect(slice.nodes.filter((n) => n.column === 1)).toHaveLength(
      MAX_COLUMN_NODES
    );
    expect(slice.overflow).toEqual([{ column: 1, ids: ['u00', 'u01', 'u02'] }]);
  });

  test('drops a prerequisite from the overflow once a deeper level draws it', () => {
    /** @type {DepIssue[]} */
    const rows = [];
    const ids = Array.from(
      { length: MAX_COLUMN_NODES + 1 },
      (_, i) => `p${String(i).padStart(2, '0')}`
    );
    const last = ids[ids.length - 1];
    rows.push(row('f', { blocks: ids }));
    for (const id of ids) {
      rows.push(row(id, id === ids[0] ? { blocks: [last] } : {}));
    }
    const index = buildDepIndex(rows);
    const slice = collectGraphSlice(index, 'f', { max_depth: 2 });
    expect(columns(slice)[last]).toBe(-2);
    expect(slice.overflow).toEqual([]);
    expect(slice.edges.some((e) => e.from === last && e.to === ids[0])).toBe(
      true
    );
  });

  test('drops a folded unlock once a deeper level draws it', () => {
    const index = buildDepIndex([
      row('x'),
      row('e', { blocks: ['x'] }),
      row('y', { blocks: ['x'] }),
      row('c', { parent: 'e', blocks: ['y'] })
    ]);
    const shallow = collectGraphSlice(index, 'x', { max_depth: 1 });
    expect(shallow.folded).toEqual([{ id: 'e', ids: ['c'] }]);
    const slice = collectGraphSlice(index, 'x', { max_depth: 2 });
    expect(columns(slice)).toEqual({ c: 2, e: 3, x: 0, y: 1 });
    expect(slice.folded).toEqual([]);
    expect(slice.edges.some((e) => e.from === 'y' && e.to === 'c')).toBe(true);
  });

  test('layers by longest path so no ordering edge runs backwards', () => {
    const index = buildDepIndex([
      row('p'),
      row('f', { parent: 'p' }),
      row('m', { parent: 'p' }),
      row('k', { parent: 'm', blocks: ['f'] }),
      row('a'),
      row('b', { blocks: ['a'] }),
      row('g', { blocks: ['a', 'b'] })
    ]);
    const slice = collectGraphSlice(index, 'f', { max_depth: 3 });
    expect(columns(slice)).toEqual({ f: 0, k: 1, m: 2, p: 3 });
    const col = columns(slice);
    for (const e of slice.edges) {
      expect(col[e.to]).toBeGreaterThan(col[e.from]);
    }
    const up = collectGraphSlice(index, 'g');
    expect(columns(up)).toEqual({ a: -2, b: -1, g: 0 });
  });

  test('marks inherited edges implied when their via is on the canvas', () => {
    const index = buildDepIndex([
      row('b'),
      row('ep', { blocks: ['b'] }),
      row('t', { parent: 'ep' })
    ]);
    const slice = collectGraphSlice(index, 't');
    expect(columns(slice)).toEqual({ b: -1, ep: 1, t: 0 });
    expect(slice.edges).toEqual([
      {
        from: 'b',
        to: 'ep',
        kind: 'blocks',
        via: null,
        implied: false,
        cycle: false
      },
      {
        from: 'b',
        to: 't',
        kind: 'inherited',
        via: 'ep',
        implied: true,
        cycle: false
      },
      {
        from: 't',
        to: 'ep',
        kind: 'child',
        via: null,
        implied: false,
        cycle: false
      }
    ]);
    const no_via = collectGraphSlice(index, 'b', { max_depth: 1 });
    expect(columns(no_via)).toEqual({ b: 0, ep: 1 });
    expect(no_via.folded).toEqual([{ id: 'ep', ids: ['t'] }]);
  });

  test('folds inherited children unless their container is expanded', () => {
    const index = buildDepIndex([
      row('f'),
      row('ep', { blocks: ['f'] }),
      row('k1', { parent: 'ep' }),
      row('k2', { parent: 'ep' })
    ]);
    const folded = collectGraphSlice(index, 'f', { max_depth: 1 });
    expect(columns(folded)).toEqual({ ep: 1, f: 0 });
    expect(folded.folded).toEqual([{ id: 'ep', ids: ['k1', 'k2'] }]);
    const open = collectGraphSlice(index, 'f', {
      max_depth: 1,
      expanded: ['ep']
    });
    expect(columns(open)).toEqual({ ep: 2, f: 0, k1: 1, k2: 1 });
    expect(open.folded).toEqual([]);
    const implied = open.edges.filter((e) => e.implied).map((e) => e.to);
    expect(implied).toEqual(['k1', 'k2']);
  });

  test('adds closed neighbours as leaves only when asked', () => {
    const index = buildDepIndex([
      row('old', { status: 'closed' }),
      row('older', { status: 'closed' }),
      row('old2', { status: 'closed', blocks: ['older'] }),
      row('t', { blocks: ['old', 'old2'] })
    ]);
    expect(columns(collectGraphSlice(index, 't'))).toEqual({ t: 0 });
    const history = collectGraphSlice(index, 't', { include_closed: true });
    expect(columns(history)).toEqual({ old: -1, old2: -1, t: 0 });
    expect(history.nodes.find((n) => n.id === 'old')?.state).toBe('closed');
    const closed_focus = collectGraphSlice(index, 'old2', {
      include_closed: true
    });
    expect(columns(closed_focus)).toEqual({ old2: 0, older: -1, t: 1 });
  });
});

describe('searchFocusCandidates', () => {
  test('ranks id matches before title matches and open before closed', () => {
    const index = buildDepIndex([
      row('ui-1', { title: 'Fix login' }),
      row('ui-10', { title: 'Other', status: 'closed' }),
      row('ui-2', { title: 'ui-1 follow up' }),
      row('api-ui-1', { title: 'Unrelated' })
    ]);
    const ids = searchFocusCandidates(index, 'UI-1').map((e) => e.id);
    expect(ids).toEqual(['ui-1', 'ui-10', 'ui-2', 'api-ui-1']);
    expect(searchFocusCandidates(index, 'login').map((e) => e.id)).toEqual([
      'ui-1'
    ]);
    expect(searchFocusCandidates(index, '  ')).toEqual([]);
    expect(searchFocusCandidates(index, 'ui', { limit: 1 })).toHaveLength(1);
  });
});

describe('hasOrderingRelations', () => {
  test('ignores parent-child-only relations', () => {
    expect(ORDERING_DEP_TYPES).toEqual(['blocks']);
    const index = buildDepIndex([
      row('ep', { blocks: ['x'] }),
      row('x'),
      row('t', { parent: 'ep' }),
      row('plain'),
      row('kid', { parent: 'plain' }),
      row('ctx', { related: ['plain'] })
    ]);
    /** @param {string} id */
    const entry = (id) => {
      const e = index.entries.get(id);
      if (!e) {
        throw new Error(`missing ${id}`);
      }
      return e;
    };
    expect(hasOrderingRelations(entry('ep'))).toBe(true);
    expect(hasOrderingRelations(entry('x'))).toBe(true);
    expect(hasOrderingRelations(entry('t'))).toBe(true);
    expect(hasOrderingRelations(entry('plain'))).toBe(false);
    expect(hasOrderingRelations(entry('kid'))).toBe(false);
    expect(hasOrderingRelations(entry('ctx'))).toBe(false);
    expect(hasOrderingRelations(row('r', { blocks: ['y'] }))).toBe(true);
    expect(hasOrderingRelations(row('r', { parent: 'p' }))).toBe(false);
    expect(
      hasOrderingRelations({
        id: 'd',
        dependents: [{ id: 'z', dependency_type: 'blocks' }]
      })
    ).toBe(true);
  });
});

describe('bd 0.63.3 parity', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const now_ms = Date.parse(fixture.captured_at);

  test('derives bd ready ids from the open set', () => {
    expect(deriveBdReadyIds(fixture.open_set, now_ms)).toEqual(
      fixture.ready_ids
    );
  });

  test('derives bd blocked ids and blocked_by from the open set', () => {
    const blocked = deriveBdBlocked(fixture.open_set);
    expect(blocked.map((b) => b.id)).toEqual(fixture.blocked_ids);
    expect(blocked).toEqual(
      fixture.blocked.map(
        (/** @type {{ id: string, blocked_by: string[] }} */ b) => ({
          id: b.id,
          blocked_by: b.blocked_by
        })
      )
    );
  });

  test('gives the same result for shuffled input', () => {
    for (const seed of SHUFFLE_SEEDS) {
      const rows = shuffled(fixture.open_set, seed);
      expect(deriveBdReadyIds(rows, now_ms)).toEqual(fixture.ready_ids);
      expect(deriveBdBlocked(rows).map((b) => b.id)).toEqual(
        fixture.blocked_ids
      );
    }
  });

  test('compares defer_until as written against now', () => {
    const rows = [
      { id: 'a', status: 'open', defer_until: '2026-01-01T00:00:00Z' },
      { id: 'b', status: 'open', defer_until: null },
      { id: 'c', status: 'open', defer_until: 'not a date' }
    ];
    expect(deriveBdReadyIds(rows, Date.parse('2025-12-31T23:59:59Z'))).toEqual([
      'b',
      'c'
    ]);
    expect(deriveBdReadyIds(rows, Date.parse('2026-01-01T00:00:00Z'))).toEqual([
      'a',
      'b',
      'c'
    ]);
  });
});

describe('graph subscription', () => {
  test('names the open-set spec and the client ids', () => {
    expect(graphIssuesSpec()).toEqual({ type: GRAPH_ISSUES_TYPE });
    expect(GRAPH_ISSUES_TYPE).toBe('graph-issues');
    expect(GRAPH_CLIENT_ID).toBe('tab:graph');
    expect(BOARD_INDEX_CLIENT_ID).toBe('tab:board-index');
    expect(BOARD_INDEX_CLIENT_ID.startsWith('tab:board:')).toBe(false);
  });
});
