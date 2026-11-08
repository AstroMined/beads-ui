/**
 * Layered layout for the dependency graph pane.
 *
 * Pure and deterministic: the same nodes and edges in any input order yield
 * the same coordinates and paths. No DOM access; the caller renders the
 * result as SVG. Columns come from the caller (negative for prerequisites,
 * 0 for the focus, positive for unlocks); this module orders rows within
 * each column with barycenter sweeps and draws the edges.
 */

/** Width of one node box in px. */
export const NODE_WIDTH = 200;
/** Height of one node box in px. */
export const NODE_HEIGHT = 48;
/** Horizontal gap between adjacent columns in px. */
export const COLUMN_GAP = 80;
/** Vertical gap between adjacent rows in px. */
export const ROW_GAP = 24;
/** Empty margin around the whole layout in px. */
export const PADDING = 24;
/**
 * How far the control points of a back-edge arc reach past its endpoints.
 * Kept at or below PADDING so arcs on the outer rows and the last column stay
 * inside the canvas (a cubic stays within the hull of its control points).
 */
export const ARC_LIFT = 24;
/** Number of down-then-up barycenter passes used to reduce crossings. */
export const SWEEP_PASSES = 4;
/** Fraction of NODE_WIDTH where a self-loop leaves and re-enters a node. */
const SELF_LOOP_START = 0.6;
const SELF_LOOP_END = 0.4;
/** Decimal places kept in SVG path coordinates. */
const PATH_PRECISION = 2;

/**
 * @typedef {'blocks'|'inherited'|'child'|'related'} LayoutEdgeKind
 */

/**
 * @typedef {{ id: string, column: number }} LayoutNodeInput
 */

/**
 * @typedef {{ from: string, to: string, kind: LayoutEdgeKind, cycle?: boolean }} LayoutEdgeInput
 */

/**
 * @typedef {{ nodes: LayoutNodeInput[], edges: LayoutEdgeInput[] }} LayoutInput
 */

/**
 * @typedef {{ id: string, column: number, row: number, x: number, y: number, width: number, height: number }} LayoutNode
 */

/**
 * @typedef {{ from: string, to: string, kind: LayoutEdgeKind, cycle: boolean, path: string }} LayoutEdge
 */

/**
 * @typedef {{ nodes: LayoutNode[], edges: LayoutEdge[], width: number, height: number }} GraphLayout
 */

/**
 * @param {string} a
 * @param {string} b
 */
function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {LayoutEdgeInput} a
 * @param {LayoutEdgeInput} b
 */
function cmpEdge(a, b) {
  return cmpStr(a.from, b.from) || cmpStr(a.to, b.to) || cmpStr(a.kind, b.kind);
}

/**
 * Format a coordinate for an SVG path without float noise.
 *
 * @param {number} n
 */
function num(n) {
  return String(Number(n.toFixed(PATH_PRECISION)));
}

/**
 * @param {number[][]} points - [x, y] for start, control 1, control 2, end.
 */
function cubic(points) {
  const [p0, p1, p2, p3] = points.map(([x, y]) => `${num(x)} ${num(y)}`);
  return `M ${p0} C ${p1}, ${p2}, ${p3}`;
}

/**
 * Count crossings between edges that share both a source and a target
 * column, for the given row positions.
 *
 * @param {Array<{ from: string, to: string }>} forward - Edges whose target column index is greater than the source's.
 * @param {Map<string, number>} col_of - Node id to column index.
 * @param {Map<string, number>} pos_of - Node id to vertical slot position.
 */
function countCrossings(forward, col_of, pos_of) {
  let crossings = 0;
  for (let i = 0; i < forward.length; i++) {
    const e1 = forward[i];
    for (let j = i + 1; j < forward.length; j++) {
      const e2 = forward[j];
      if (
        col_of.get(e1.from) !== col_of.get(e2.from) ||
        col_of.get(e1.to) !== col_of.get(e2.to)
      ) {
        continue;
      }
      const ds = Number(pos_of.get(e1.from)) - Number(pos_of.get(e2.from));
      const dt = Number(pos_of.get(e1.to)) - Number(pos_of.get(e2.to));
      if (ds * dt < 0) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Compute node positions and edge paths for a column-layered graph.
 *
 * Columns map left to right in ascending `column` order, with unused column
 * numbers collapsed. Each column is centered vertically against the tallest
 * one. Forward edges are cubic beziers from the right edge of the source to
 * the left edge of the target. Back edges (target column before the source
 * column) arc above or below the layout rows; edges within one column bulge
 * out to the right of it; self-loops curl over the top of their node.
 * Edges that name an unknown node are dropped, and a repeated node id keeps
 * its first column.
 *
 * @param {LayoutInput} input
 * @returns {GraphLayout}
 */
export function layoutGraph(input) {
  /** @type {Map<string, number>} */
  const column_value = new Map();
  for (const n of input.nodes) {
    if (!column_value.has(n.id)) {
      column_value.set(n.id, n.column);
    }
  }
  if (column_value.size === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const ids = Array.from(column_value.keys()).sort(cmpStr);
  const distinct = Array.from(new Set(column_value.values())).sort(
    (a, b) => a - b
  );
  /** @type {Map<number, number>} */
  const index_of_value = new Map(distinct.map((v, i) => [v, i]));
  /** @type {Map<string, number>} */
  const col_of = new Map();
  for (const [id, value] of column_value) {
    col_of.set(id, Number(index_of_value.get(value)));
  }

  /** @type {string[][]} */
  const columns = distinct.map(() => []);
  for (const id of ids) {
    columns[Number(col_of.get(id))].push(id);
  }
  const max_rows = Math.max(...columns.map((c) => c.length));

  const edges = input.edges
    .filter((e) => col_of.has(e.from) && col_of.has(e.to))
    .sort(cmpEdge);
  const forward = edges.filter(
    (e) => Number(col_of.get(e.to)) > Number(col_of.get(e.from))
  );

  /** @type {Map<string, string[]>} Neighbors in columns to the left. */
  const left_of = new Map(ids.map((id) => [id, []]));
  /** @type {Map<string, string[]>} Neighbors in columns to the right. */
  const right_of = new Map(ids.map((id) => [id, []]));
  for (const e of forward) {
    left_of.get(e.to)?.push(e.from);
    right_of.get(e.from)?.push(e.to);
  }

  /**
   * Vertical slot of every node: its row plus the centering offset of its
   * column, so barycenters compare positions as drawn.
   *
   * @param {string[][]} order
   */
  function positions(order) {
    /** @type {Map<string, number>} */
    const pos = new Map();
    for (const col of order) {
      const offset = (max_rows - col.length) / 2;
      col.forEach((id, row) => pos.set(id, offset + row));
    }
    return pos;
  }

  /**
   * Reorder one column by the mean slot of its neighbors on the fixed side.
   * A node with no such neighbors keeps its current slot; ties go by id.
   *
   * @param {string[][]} order
   * @param {number} c
   * @param {Map<string, string[]>} neighbors
   */
  function reorder(order, c, neighbors) {
    const pos = positions(order);
    /** @type {Map<string, number>} */
    const key = new Map();
    for (const id of order[c]) {
      const ns = neighbors.get(id) ?? [];
      const sum = ns.reduce((acc, n) => acc + Number(pos.get(n)), 0);
      key.set(id, ns.length > 0 ? sum / ns.length : Number(pos.get(id)));
    }
    order[c] = order[c]
      .slice()
      .sort((a, b) => Number(key.get(a)) - Number(key.get(b)) || cmpStr(a, b));
  }

  let order = columns.map((c) => c.slice());
  let best = order.map((c) => c.slice());
  let best_crossings = countCrossings(forward, col_of, positions(best));
  for (let pass = 0; pass < SWEEP_PASSES && best_crossings > 0; pass++) {
    for (let c = 1; c < order.length; c++) {
      reorder(order, c, left_of);
    }
    for (let c = order.length - 2; c >= 0; c--) {
      reorder(order, c, right_of);
    }
    const crossings = countCrossings(forward, col_of, positions(order));
    if (crossings < best_crossings) {
      best_crossings = crossings;
      best = order.map((c) => c.slice());
    }
  }
  order = best;

  const slot_height = NODE_HEIGHT + ROW_GAP;
  /** @type {LayoutNode[]} */
  const out_nodes = [];
  /** @type {Map<string, LayoutNode>} */
  const node_of = new Map();
  order.forEach((col, c) => {
    const offset = ((max_rows - col.length) / 2) * slot_height;
    col.forEach((id, row) => {
      const node = {
        id,
        column: Number(column_value.get(id)),
        row,
        x: PADDING + c * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + offset + row * slot_height,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      };
      out_nodes.push(node);
      node_of.set(id, node);
    });
  });

  const width =
    2 * PADDING + order.length * NODE_WIDTH + (order.length - 1) * COLUMN_GAP;
  const height =
    2 * PADDING + max_rows * NODE_HEIGHT + (max_rows - 1) * ROW_GAP;

  /** @type {LayoutEdge[]} */
  const out_edges = [];
  for (const e of edges) {
    const s = node_of.get(e.from);
    const t = node_of.get(e.to);
    if (!s || !t) {
      continue;
    }
    const sc = Number(col_of.get(e.from));
    const tc = Number(col_of.get(e.to));
    const back = tc <= sc;
    out_edges.push({
      from: e.from,
      to: e.to,
      kind: e.kind,
      cycle: e.cycle === true,
      path: back ? backPath(s, t, sc === tc, height) : forwardPath(s, t)
    });
  }

  return { nodes: out_nodes, edges: out_edges, width, height };
}

/**
 * @param {LayoutNode} s
 * @param {LayoutNode} t
 */
function forwardPath(s, t) {
  const sx = s.x + s.width;
  const sy = s.y + s.height / 2;
  const tx = t.x;
  const ty = t.y + t.height / 2;
  const dx = (tx - sx) / 2;
  return cubic([
    [sx, sy],
    [sx + dx, sy],
    [tx - dx, ty],
    [tx, ty]
  ]);
}

/**
 * @param {LayoutNode} s
 * @param {LayoutNode} t
 * @param {boolean} same_column
 * @param {number} height - Total layout height, to pick above or below.
 */
function backPath(s, t, same_column, height) {
  if (s.id === t.id) {
    const y = s.y;
    const x0 = s.x + s.width * SELF_LOOP_START;
    const x1 = s.x + s.width * SELF_LOOP_END;
    return cubic([
      [x0, y],
      [x0, y - ARC_LIFT],
      [x1, y - ARC_LIFT],
      [x1, y]
    ]);
  }
  if (same_column) {
    const x = s.x + s.width;
    const sy = s.y + s.height / 2;
    const ty = t.y + t.height / 2;
    return cubic([
      [x, sy],
      [x + ARC_LIFT, sy],
      [x + ARC_LIFT, ty],
      [x, ty]
    ]);
  }
  const sx = s.x + s.width / 2;
  const tx = t.x + t.width / 2;
  const mid = (s.y + t.y + s.height) / 2;
  if (mid <= height / 2) {
    const cy = Math.min(s.y, t.y) - ARC_LIFT;
    return cubic([
      [sx, s.y],
      [sx, cy],
      [tx, cy],
      [tx, t.y]
    ]);
  }
  const sy = s.y + s.height;
  const ty = t.y + t.height;
  const cy = Math.max(sy, ty) + ARC_LIFT;
  return cubic([
    [sx, sy],
    [sx, cy],
    [tx, cy],
    [tx, ty]
  ]);
}
