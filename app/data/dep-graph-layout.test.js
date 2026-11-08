import { describe, expect, test } from 'vitest';
import {
  ARC_LIFT,
  COLUMN_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  PADDING,
  ROW_GAP,
  layoutGraph
} from './dep-graph-layout.js';

/**
 * @param {import('./dep-graph-layout.js').GraphLayout} layout
 * @param {string} id
 */
function nodeById(layout, id) {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) {
    throw new Error(`missing node ${id}`);
  }
  return node;
}

/**
 * @param {import('./dep-graph-layout.js').GraphLayout} layout
 * @param {string} from
 * @param {string} to
 */
function edgeBetween(layout, from, to) {
  const edge = layout.edges.find((e) => e.from === from && e.to === to);
  if (!edge) {
    throw new Error(`missing edge ${from}->${to}`);
  }
  return edge;
}

describe('layoutGraph', () => {
  test('returns an empty layout for empty input', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual({
      nodes: [],
      edges: [],
      width: 0,
      height: 0
    });
  });

  test('places a single node inside the padding', () => {
    const layout = layoutGraph({
      nodes: [{ id: 'UI-1', column: 0 }],
      edges: []
    });

    expect(layout.nodes).toEqual([
      {
        id: 'UI-1',
        column: 0,
        row: 0,
        x: PADDING,
        y: PADDING,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      }
    ]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(2 * PADDING + NODE_WIDTH);
    expect(layout.height).toBe(2 * PADDING + NODE_HEIGHT);
  });

  test('derives coordinates from the size constants', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'a', column: -1 },
        { id: 'b', column: -1 },
        { id: 'f', column: 0 },
        { id: 'u', column: 3 }
      ],
      edges: [
        { from: 'a', to: 'f', kind: 'blocks' },
        { from: 'b', to: 'f', kind: 'blocks' },
        { from: 'f', to: 'u', kind: 'blocks' }
      ]
    });

    const slot = NODE_HEIGHT + ROW_GAP;
    const a = nodeById(layout, 'a');
    const b = nodeById(layout, 'b');
    const f = nodeById(layout, 'f');
    const u = nodeById(layout, 'u');
    expect([a.x, a.y, a.row]).toEqual([PADDING, PADDING, 0]);
    expect([b.x, b.y, b.row]).toEqual([PADDING, PADDING + slot, 1]);
    // Single-node columns center against the two-row column.
    expect(f.x).toBe(PADDING + NODE_WIDTH + COLUMN_GAP);
    expect(f.y).toBe(PADDING + slot / 2);
    // Unused column numbers collapse: column 3 sits right after column 0.
    expect(u.x).toBe(PADDING + 2 * (NODE_WIDTH + COLUMN_GAP));
    expect(u.column).toBe(3);
    expect(layout.width).toBe(2 * PADDING + 3 * NODE_WIDTH + 2 * COLUMN_GAP);
    expect(layout.height).toBe(2 * PADDING + 2 * NODE_HEIGHT + ROW_GAP);

    const sx = a.x + NODE_WIDTH;
    const sy = a.y + NODE_HEIGHT / 2;
    const tx = f.x;
    const ty = f.y + NODE_HEIGHT / 2;
    const dx = (tx - sx) / 2;
    expect(edgeBetween(layout, 'a', 'f').path).toBe(
      `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
    );
  });

  test('resolves a two-column crossing with the sweeps', () => {
    // Id order alone puts a over b and c over d, so a->d and b->c cross.
    const layout = layoutGraph({
      nodes: [
        { id: 'a', column: 0 },
        { id: 'b', column: 0 },
        { id: 'c', column: 1 },
        { id: 'd', column: 1 }
      ],
      edges: [
        { from: 'a', to: 'd', kind: 'blocks' },
        { from: 'b', to: 'c', kind: 'blocks' }
      ]
    });

    const a = nodeById(layout, 'a');
    const b = nodeById(layout, 'b');
    const c = nodeById(layout, 'c');
    const d = nodeById(layout, 'd');
    expect(Math.sign(a.y - b.y)).toBe(Math.sign(d.y - c.y));
  });

  test('draws a back edge as an arc distinct from a forward bezier', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'x', column: 0 },
        { id: 'y', column: 1 }
      ],
      edges: [
        { from: 'x', to: 'y', kind: 'blocks' },
        { from: 'y', to: 'x', kind: 'blocks', cycle: true }
      ]
    });

    const x = nodeById(layout, 'x');
    const y = nodeById(layout, 'y');
    const forward = edgeBetween(layout, 'x', 'y');
    const back = edgeBetween(layout, 'y', 'x');
    expect(forward.cycle).toBe(false);
    expect(back.cycle).toBe(true);
    expect(back.path).not.toBe(forward.path);
    // The arc leaves the top center of y, lifts above both nodes, and lands
    // on the top center of x.
    const cy = PADDING - ARC_LIFT;
    expect(back.path).toBe(
      `M ${y.x + NODE_WIDTH / 2} ${y.y} C ${y.x + NODE_WIDTH / 2} ${cy}, ` +
        `${x.x + NODE_WIDTH / 2} ${cy}, ${x.x + NODE_WIDTH / 2} ${x.y}`
    );
  });

  test('flags an edge within one column as a cycle', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'p', column: 0 },
        { id: 'q', column: 0 }
      ],
      edges: [{ from: 'p', to: 'q', kind: 'related' }]
    });

    const edge = edgeBetween(layout, 'p', 'q');
    expect(edge.cycle).toBe(true);
    expect(edge.path.startsWith(`M ${PADDING + NODE_WIDTH} `)).toBe(true);
  });

  test('produces identical output for shuffled input', () => {
    /** @type {import('./dep-graph-layout.js').LayoutInput} */
    const input = {
      nodes: [
        { id: 'p1', column: -2 },
        { id: 'p2', column: -1 },
        { id: 'p3', column: -1 },
        { id: 'p4', column: -1 },
        { id: 'f', column: 0 },
        { id: 'u1', column: 1 },
        { id: 'u2', column: 1 },
        { id: 'u3', column: 2 }
      ],
      edges: [
        { from: 'p1', to: 'p3', kind: 'blocks' },
        { from: 'p1', to: 'p4', kind: 'inherited' },
        { from: 'p2', to: 'f', kind: 'blocks' },
        { from: 'p3', to: 'f', kind: 'child' },
        { from: 'p4', to: 'f', kind: 'blocks' },
        { from: 'f', to: 'u1', kind: 'blocks' },
        { from: 'f', to: 'u2', kind: 'blocks' },
        { from: 'u2', to: 'u3', kind: 'related' },
        { from: 'u3', to: 'p2', kind: 'blocks', cycle: true }
      ]
    };
    const shuffled = {
      nodes: [
        input.nodes[5],
        input.nodes[2],
        input.nodes[7],
        input.nodes[0],
        input.nodes[4],
        input.nodes[6],
        input.nodes[3],
        input.nodes[1]
      ],
      edges: input.edges.slice().reverse()
    };

    expect(layoutGraph(shuffled)).toEqual(layoutGraph(input));
  });

  test('breaks barycenter ties by id', () => {
    const layout = layoutGraph({
      nodes: [
        { id: 'f', column: 0 },
        { id: 'z', column: 1 },
        { id: 'm', column: 1 },
        { id: 'b', column: 1 }
      ],
      edges: [
        { from: 'f', to: 'z', kind: 'blocks' },
        { from: 'f', to: 'm', kind: 'blocks' },
        { from: 'f', to: 'b', kind: 'blocks' }
      ]
    });

    const right = layout.nodes
      .filter((n) => n.column === 1)
      .sort((p, q) => p.row - q.row)
      .map((n) => n.id);
    expect(right).toEqual(['b', 'm', 'z']);
  });

  test('drops edges that name an unknown node', () => {
    const layout = layoutGraph({
      nodes: [{ id: 'a', column: 0 }],
      edges: [{ from: 'a', to: 'ghost', kind: 'blocks' }]
    });

    expect(layout.edges).toEqual([]);
  });
});
