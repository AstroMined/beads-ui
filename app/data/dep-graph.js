/**
 * Pure dependency model shared by the Board filters, the Graph tab and the
 * server's derived Ready and Blocked columns.
 *
 * Edges come from list rows: in row X, `{ depends_on_id: Y, type: 'blocks' }`
 * means Y must close before X can start. `parent-child` edges (merged with the
 * `parent` field) are containment. Every other type is context only. An id
 * that an edge names but no row carries is "external, status unknown" and is
 * never expanded.
 *
 * Every function is deterministic for shuffled input and iterative, so a deep
 * chain cannot overflow the call stack.
 */
import { DEFAULT_PRIORITY } from '../utils/priority.js';

/** Dependency types that order work. Other types are listed, never ordered. */
export const ORDERING_DEP_TYPES = Object.freeze(['blocks']);

/** Statuses `canStart` accepts; bd 0.63.3 ready admits only `open`. */
export const START_STATUSES = Object.freeze(['open']);

/** Most nodes a graph slice may hold before its depth is lowered. */
export const MAX_GRAPH_NODES = 100;

/**
 * Most nodes kept in each depth-1 column of a slice; the rest are reported as
 * overflow. Two full columns plus the focus stay under MAX_GRAPH_NODES.
 */
export const MAX_COLUMN_NODES = 30;

/** Default length of each suggestion list. */
export const SUGGESTION_LIMIT = 5;

/** Default number of focus search results. */
export const SEARCH_RESULT_LIMIT = 20;

/** Containment edge type, merged with the `parent` field. */
const PARENT_CHILD_TYPE = 'parent-child';

/** The status shown as `closed` in the graph. */
const DONE_STATUS = 'closed';

/**
 * Statuses that count as done for ordering. bd 0.63.3 leaves both out of
 * the open set, so neither ever blocks nor waits on anything.
 */
const DONE_STATUSES = new Set([DONE_STATUS, 'pinned']);

/**
 * Whether a status counts as done for ordering. An unknown id has none.
 *
 * @param {string | undefined} status
 */
function isDoneStatus(status) {
  return status !== undefined && DONE_STATUSES.has(status);
}

/** The only dependency type bd 0.63.3 treats as blocking. */
const BD_BLOCKING_DEP_TYPE = 'blocks';

/** The only status bd 0.63.3 ready admits. */
const BD_READY_STATUS = 'open';

const ORDERING_TYPE_SET = new Set(ORDERING_DEP_TYPES);
const START_STATUS_SET = new Set(START_STATUSES);

/** Search ranks, best first. */
const RANK_EXACT_ID = 0;
const RANK_ID_PREFIX = 1;
const RANK_TITLE_PREFIX = 2;
const RANK_ID_SUBSTRING = 3;
const RANK_TITLE_SUBSTRING = 4;

/**
 * One dependency edge, in the list shape (`depends_on_id`, `type`) or the
 * detail shape (`id`, `dependency_type`).
 *
 * @typedef {{ depends_on_id?: string, id?: string, type?: string, dependency_type?: string }} DepEdgeInput
 */

/**
 * An input row. Rows may be partial, for example a board card.
 *
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   status?: string,
 *   priority?: number,
 *   issue_type?: string,
 *   assignee?: string | null,
 *   parent?: string | null,
 *   labels?: string[],
 *   dependencies?: DepEdgeInput[],
 *   dependents?: DepEdgeInput[],
 *   defer_until?: string | null,
 *   ephemeral?: boolean
 * }} DepIssue
 */

/**
 * @typedef {'blocks'|'inherited'|'child'} DepReason
 */

/**
 * One effective prerequisite relation. In `prereqs_of[X]` the `id` is the
 * prerequisite; in `unlocks_of[P]` it is the dependent. `via` names the
 * ancestor whose blocker is inherited, and is null otherwise.
 *
 * @typedef {{ id: string, reason: DepReason, via: string | null }} DepLink
 */

/**
 * A context-only edge. `direction` is `out` when this bead's row carries the
 * edge and `in` when the other bead's row does.
 *
 * @typedef {{ id: string, type: string, direction: 'out'|'in' }} RelatedRef
 */

/**
 * @typedef {{
 *   id: string,
 *   issue: DepIssue,
 *   status: string,
 *   parent: string | null,
 *   children: string[],
 *   blockers: string[],
 *   dependents: string[],
 *   related: RelatedRef[],
 *   has_ordering: boolean
 * }} DepIndexEntry
 */

/**
 * `blockers` and `dependents` are the raw ordering edges in either status;
 * `prereqs_of` and `unlocks_of` hold only the open relations. `cycle_ids`
 * holds every cycle member and everything downstream of one.
 *
 * @typedef {{
 *   entries: Map<string, DepIndexEntry>,
 *   ids: string[],
 *   external_ids: string[],
 *   prereqs_of: Map<string, DepLink[]>,
 *   unlocks_of: Map<string, DepLink[]>,
 *   cycles: string[][],
 *   cycle_of: Map<string, number>,
 *   cycle_ids: Set<string>
 * }} DepIndex
 */

/**
 * @typedef {'closed'|'external'|'cycle'|'blocked'|'ready'|'held'} NodeState
 */

/**
 * @typedef {{ id: string, state: NodeState, reasons: DepLink[] }} WorkItem
 */

/**
 * @typedef {{ step: number, items: WorkItem[] }} WorkStep
 */

/**
 * @typedef {{
 *   focus: string,
 *   goal: 'start'|'close',
 *   goal_step: number,
 *   goal_state: NodeState,
 *   steps: WorkStep[],
 *   total: number,
 *   has_cycle: boolean
 * }} WorkOrder
 */

/**
 * @typedef {{ id: string, reasons: DepLink[], folded: string[] }} UnlockGroup
 */

/**
 * @typedef {{
 *   focus: string,
 *   immediate: UnlockGroup[],
 *   waves: UnlockGroup[][],
 *   still_waiting: Array<{ id: string, waits_on: string[] }>,
 *   total: number
 * }} Unlocks
 */

/**
 * @typedef {{
 *   start_here: Array<{ id: string, downstream: number }>,
 *   most_blocked: Array<{ id: string, upstream: number }>
 * }} Suggestions
 */

/**
 * @typedef {{ id: string, column: number, state: NodeState, focus: boolean }} SliceNode
 */

/**
 * @typedef {{
 *   from: string,
 *   to: string,
 *   kind: DepReason | 'related',
 *   via: string | null,
 *   implied: boolean,
 *   cycle: boolean
 * }} SliceEdge
 */

/**
 * @typedef {{
 *   focus: string,
 *   depth: number,
 *   reached_depth: number,
 *   requested_depth: number,
 *   truncated: boolean,
 *   nodes: SliceNode[],
 *   edges: SliceEdge[],
 *   overflow: Array<{ column: number, ids: string[] }>,
 *   folded: Array<{ id: string, ids: string[] }>
 * }} GraphSlice
 */

/**
 * @param {string} a
 * @param {string} b
 */
function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {DepLink} a
 * @param {DepLink} b
 */
function cmpLink(a, b) {
  return (
    cmpStr(a.id, b.id) ||
    cmpStr(a.reason, b.reason) ||
    cmpStr(a.via ?? '', b.via ?? '')
  );
}

/**
 * Far end of an edge, or '' when it names none.
 *
 * @param {DepEdgeInput} edge
 */
function edgeTarget(edge) {
  if (!edge || typeof edge !== 'object') {
    return '';
  }
  if (typeof edge.depends_on_id === 'string' && edge.depends_on_id) {
    return edge.depends_on_id;
  }
  return typeof edge.id === 'string' ? edge.id : '';
}

/**
 * Type of an edge, or '' when it carries none (context only).
 *
 * @param {DepEdgeInput} edge
 */
function edgeType(edge) {
  if (typeof edge.type === 'string') {
    return edge.type;
  }
  return typeof edge.dependency_type === 'string' ? edge.dependency_type : '';
}

/**
 * @param {DepIssue} row
 * @returns {DepEdgeInput[]}
 */
function edgesOf(row) {
  return Array.isArray(row.dependencies) ? row.dependencies : [];
}

/**
 * Parent of a row: the `parent` field, else the smallest parent-child target.
 *
 * @param {DepIssue} row
 * @returns {string | null}
 */
function parentOf(row) {
  if (typeof row.parent === 'string' && row.parent && row.parent !== row.id) {
    return row.parent;
  }
  /** @type {string | null} */
  let best = null;
  for (const edge of edgesOf(row)) {
    const target = edgeTarget(edge);
    if (
      edgeType(edge) === PARENT_CHILD_TYPE &&
      target &&
      target !== row.id &&
      (best === null || target < best)
    ) {
      best = target;
    }
  }
  return best;
}

/**
 * Merge rows that share an id. A later row's fields win over an earlier
 * row's, a missing field keeps the earlier value, and edges and labels are
 * unioned, so a partial board card never drops edges a full row carried.
 *
 * @param {DepIssue[]} rows
 * @returns {Map<string, DepIssue>}
 */
function mergeRows(rows) {
  /** @type {Map<string, DepIssue>} */
  const by_id = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || row.id.length === 0) {
      continue;
    }
    const prev = by_id.get(row.id);
    if (!prev) {
      by_id.set(row.id, { ...row });
      continue;
    }
    /** @type {DepIssue} */
    const merged = { ...prev, ...row };
    /** @type {Map<string, DepEdgeInput>} */
    const edges = new Map();
    for (const edge of [...edgesOf(prev), ...edgesOf(row)]) {
      edges.set(`${edgeTarget(edge)}\n${edgeType(edge)}`, edge);
    }
    merged.dependencies = Array.from(edges.values());
    if (Array.isArray(prev.labels) || Array.isArray(row.labels)) {
      merged.labels = Array.from(
        new Set([...(prev.labels ?? []), ...(row.labels ?? [])])
      ).sort(cmpStr);
    }
    by_id.set(row.id, merged);
  }
  return by_id;
}

/**
 * Map entries sorted by key.
 *
 * @template T
 * @param {Map<string, T>} map
 * @returns {Array<[string, T]>}
 */
function sortedById(map) {
  return Array.from(map).sort((a, b) => cmpStr(a[0], b[0]));
}

/**
 * Iterative Tarjan strongly connected components. Components come out in
 * reverse topological order: each one after every component it reaches.
 *
 * @param {string[]} nodes
 * @param {(id: string) => string[]} succ - Successors, restricted to `nodes`.
 * @returns {string[][]} Members of each component, sorted.
 */
function stronglyConnected(nodes, succ) {
  let counter = 0;
  /** @type {Map<string, number>} */
  const order = new Map();
  /** @type {Map<string, number>} */
  const low = new Map();
  /** @type {Set<string>} */
  const on_stack = new Set();
  /** @type {string[]} */
  const stack = [];
  /** @type {string[][]} */
  const comps = [];

  /** @param {string} id */
  function visit(id) {
    order.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    on_stack.add(id);
  }

  for (const root of nodes) {
    if (order.has(root)) {
      continue;
    }
    visit(root);
    /** @type {Array<{ id: string, next: string[], i: number }>} */
    const work = [{ id: root, next: succ(root), i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.i < frame.next.length) {
        const w = frame.next[frame.i++];
        if (!order.has(w)) {
          visit(w);
          work.push({ id: w, next: succ(w), i: 0 });
        } else if (on_stack.has(w)) {
          low.set(
            frame.id,
            Math.min(Number(low.get(frame.id)), Number(order.get(w)))
          );
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        low.set(
          parent.id,
          Math.min(Number(low.get(parent.id)), Number(low.get(frame.id)))
        );
      }
      if (low.get(frame.id) === order.get(frame.id)) {
        /** @type {string[]} */
        const comp = [];
        let member;
        do {
          member = String(stack.pop());
          on_stack.delete(member);
          comp.push(member);
        } while (member !== frame.id);
        comps.push(comp.sort(cmpStr));
      }
    }
  }
  return comps;
}

/**
 * Build the dependency index from list rows.
 *
 * Effective prerequisites of an open X, one entry per id with precedence
 * blocks, then inherited, then child:
 * 1. `blocks`: X's direct blockers that are not done.
 * 2. `inherited`: the not-done blockers of every ancestor A, `via` A, the
 *    nearest ancestor first.
 * 3. `child`: X's open children.
 * Done means a status in DONE_STATUSES (closed or pinned); a done X has no
 * prerequisites. A row without a status counts as open.
 *
 * @param {DepIssue[]} rows
 * @returns {DepIndex}
 */
export function buildDepIndex(rows) {
  const by_id = mergeRows(Array.isArray(rows) ? rows : []);
  const ids = Array.from(by_id.keys()).sort(cmpStr);
  /** @type {Map<string, DepIndexEntry>} */
  const entries = new Map();
  for (const [id, issue] of sortedById(by_id)) {
    entries.set(id, {
      id,
      issue,
      status: typeof issue.status === 'string' ? issue.status : 'open',
      parent: parentOf(issue),
      children: [],
      blockers: [],
      dependents: [],
      related: [],
      has_ordering: false
    });
  }

  /** @type {Set<string>} */
  const external = new Set();
  for (const entry of entries.values()) {
    const id = entry.id;
    if (entry.parent !== null) {
      const parent_entry = entries.get(entry.parent);
      if (parent_entry) {
        parent_entry.children.push(id);
      } else {
        external.add(entry.parent);
      }
    }
    /** @type {Set<string>} */
    const blockers = new Set();
    /** @type {Map<string, RelatedRef>} */
    const related = new Map();
    for (const edge of edgesOf(entry.issue)) {
      const target = edgeTarget(edge);
      const type = edgeType(edge);
      if (!target || type === PARENT_CHILD_TYPE) {
        continue;
      }
      if (ORDERING_TYPE_SET.has(type)) {
        blockers.add(target);
      } else {
        related.set(`${target}\n${type}`, {
          id: target,
          type,
          direction: 'out'
        });
      }
    }
    entry.blockers = Array.from(blockers).sort(cmpStr);
    for (const b of entry.blockers) {
      const target_entry = entries.get(b);
      if (target_entry) {
        target_entry.dependents.push(id);
      } else {
        external.add(b);
      }
    }
    for (const ref of related.values()) {
      entry.related.push(ref);
      entries.get(ref.id)?.related.push({
        id,
        type: ref.type,
        direction: 'in'
      });
    }
  }
  for (const entry of entries.values()) {
    entry.children.sort(cmpStr);
    entry.dependents.sort(cmpStr);
    entry.related.sort(
      (a, b) =>
        cmpStr(a.id, b.id) ||
        cmpStr(a.type, b.type) ||
        cmpStr(a.direction, b.direction)
    );
  }

  /** @param {string} id */
  const isOpenOrUnknown = (id) => !isDoneStatus(entries.get(id)?.status);

  /** @type {DepIndex} */
  const index = {
    entries,
    ids,
    external_ids: Array.from(external).sort(cmpStr),
    prereqs_of: new Map(),
    unlocks_of: new Map(),
    cycles: [],
    cycle_of: new Map(),
    cycle_ids: new Set()
  };

  for (const id of ids) {
    index.unlocks_of.set(id, []);
  }
  for (const id of index.external_ids) {
    index.unlocks_of.set(id, []);
  }

  for (const entry of entries.values()) {
    const id = entry.id;
    /** @type {Map<string, DepLink>} */
    const links = new Map();
    if (!isDoneStatus(entry.status)) {
      for (const b of entry.blockers) {
        if (isOpenOrUnknown(b)) {
          links.set(b, { id: b, reason: 'blocks', via: null });
        }
      }
      for (const a of ancestorIds(index, id)) {
        for (const b of entries.get(a)?.blockers ?? []) {
          if (isOpenOrUnknown(b) && !links.has(b)) {
            links.set(b, { id: b, reason: 'inherited', via: a });
          }
        }
      }
      for (const c of entry.children) {
        if (isOpenOrUnknown(c) && !links.has(c)) {
          links.set(c, { id: c, reason: 'child', via: null });
        }
      }
    }
    const list = Array.from(links.values()).sort(cmpLink);
    index.prereqs_of.set(id, list);
    for (const link of list) {
      index.unlocks_of
        .get(link.id)
        ?.push({ id, reason: link.reason, via: link.via });
    }
  }
  for (const list of index.unlocks_of.values()) {
    list.sort(cmpLink);
  }

  const comps = stronglyConnected(ids, (id) =>
    (index.prereqs_of.get(id) ?? [])
      .map((l) => l.id)
      .filter((p) => entries.has(p))
  );
  index.cycles = comps
    .filter(
      (c) =>
        c.length > 1 ||
        (index.prereqs_of.get(c[0]) ?? []).some((l) => l.id === c[0])
    )
    .sort((a, b) => cmpStr(a[0], b[0]));
  index.cycles.forEach((members, n) => {
    for (const m of members) {
      index.cycle_of.set(m, n);
    }
  });
  const downstream = Array.from(index.cycle_of.keys()).sort(cmpStr);
  for (const m of downstream) {
    index.cycle_ids.add(m);
  }
  for (let i = 0; i < downstream.length; i++) {
    for (const link of index.unlocks_of.get(downstream[i]) ?? []) {
      if (!index.cycle_ids.has(link.id)) {
        index.cycle_ids.add(link.id);
        downstream.push(link.id);
      }
    }
  }

  for (const entry of entries.values()) {
    /** @param {DepLink} l */
    const inherits = (l) => l.reason === 'inherited';
    entry.has_ordering =
      entry.blockers.length > 0 ||
      entry.dependents.length > 0 ||
      (index.prereqs_of.get(entry.id) ?? []).some(inherits) ||
      (index.unlocks_of.get(entry.id) ?? []).some(inherits);
  }
  return index;
}

/**
 * Ancestors of an id, nearest first, excluding the id. An unknown parent is
 * listed last since it cannot be walked further. A parent loop stops at the
 * first repeat.
 *
 * @param {DepIndex} index
 * @param {string} id
 * @returns {string[]}
 */
export function ancestorIds(index, id) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set([id]);
  let current = index.entries.get(id)?.parent ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = index.entries.get(current)?.parent ?? null;
  }
  return out;
}

/**
 * The id and every descendant, breadth first with siblings sorted by id.
 *
 * @param {DepIndex} index
 * @param {string} id
 * @returns {string[]}
 */
export function descendantIds(index, id) {
  const out = [id];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const c of index.entries.get(out[i])?.children ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * True when the id has a known, not-closed blocks or inherited prerequisite.
 * External prerequisites have an unknown status and do not count.
 *
 * @param {DepIndex} index
 * @param {string} id
 */
function hasOpenStartPrereq(index, id) {
  return (index.prereqs_of.get(id) ?? []).some(
    (l) => l.reason !== 'child' && index.entries.has(l.id)
  );
}

/**
 * Whether X can start now: it is known, its status is one bd ready admits
 * (START_STATUSES, so in_progress, blocked, deferred, hooked, pinned, closed
 * and custom statuses such as in_review are excluded), and it has no open
 * blocks or inherited prerequisite. Stricter than bd ready: inheritance
 * reaches every ancestor, not only the parent.
 *
 * @param {DepIndex} index
 * @param {string} id
 */
export function canStart(index, id) {
  const entry = index.entries.get(id);
  return (
    entry !== undefined &&
    START_STATUS_SET.has(entry.status) &&
    !hasOpenStartPrereq(index, id)
  );
}

/**
 * Whether X can close now: `canStart(X)` and no open children.
 *
 * @param {DepIndex} index
 * @param {string} id
 */
export function canClose(index, id) {
  return (
    canStart(index, id) &&
    !(index.prereqs_of.get(id) ?? []).some((l) => l.reason === 'child')
  );
}

/**
 * State of one id for display: `external` when unknown, `closed`, `cycle`
 * for a cycle member or anything downstream of one, `blocked` with an open
 * blocks or inherited prerequisite, `ready` when `canStart`, and `held` for
 * an unblocked bead whose status bd ready excludes.
 *
 * @param {DepIndex} index
 * @param {string} id
 * @returns {NodeState}
 */
export function nodeState(index, id) {
  const entry = index.entries.get(id);
  if (!entry) {
    return 'external';
  }
  if (entry.status === DONE_STATUS) {
    return 'closed';
  }
  if (index.cycle_ids.has(id)) {
    return 'cycle';
  }
  if (hasOpenStartPrereq(index, id)) {
    return 'blocked';
  }
  return START_STATUS_SET.has(entry.status) ? 'ready' : 'held';
}

/**
 * Comparator by priority ascending (unknown ids at the default), then id.
 *
 * @param {DepIndex} index
 * @returns {(a: string, b: string) => number}
 */
function byPriority(index) {
  /** @param {string} id */
  const prio = (id) =>
    index.entries.get(id)?.issue.priority ?? DEFAULT_PRIORITY;
  return (a, b) => prio(a) - prio(b) || cmpStr(a, b);
}

/**
 * Ordered plan for a focus: longest-path layers over the SCC condensation of
 * its transitive prerequisites, so Step 1 holds work that waits on nothing in
 * the plan, and a goal row follows at `goal_step`. The goal defaults to
 * `close` when the focus has open children and `start` otherwise; for
 * `start`, the focus's own children are left out (their blockers' children
 * stay in). External prerequisites are listed and never expanded.
 *
 * @param {DepIndex} index
 * @param {string} focus
 * @param {{ goal?: 'start'|'close' }} [options]
 * @returns {WorkOrder}
 */
export function computeWorkOrder(index, focus, options = {}) {
  const own = index.prereqs_of.get(focus) ?? [];
  const goal =
    options.goal ?? (own.some((l) => l.reason === 'child') ? 'close' : 'start');
  /**
   * @param {string} from
   * @param {DepLink} link
   */
  const counts = (from, link) =>
    !(goal === 'start' && from === focus && link.reason === 'child');
  /** @param {string} id */
  const linksFrom = (id) =>
    (index.prereqs_of.get(id) ?? []).filter((l) => counts(id, l));

  const queue = [focus];
  const in_plan = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const link of linksFrom(queue[i])) {
      if (!in_plan.has(link.id)) {
        in_plan.add(link.id);
        queue.push(link.id);
      }
    }
  }

  const nodes = Array.from(in_plan).sort(cmpStr);
  const comps = stronglyConnected(nodes, (id) =>
    linksFrom(id).map((l) => l.id)
  );
  /** @type {Map<string, number>} */
  const comp_of = new Map();
  comps.forEach((members, n) => {
    for (const m of members) {
      comp_of.set(m, n);
    }
  });
  /** @type {number[]} */
  const layer = [];
  comps.forEach((members, n) => {
    let depth = 0;
    for (const m of members) {
      for (const link of linksFrom(m)) {
        const c = Number(comp_of.get(link.id));
        if (c !== n) {
          depth = Math.max(depth, layer[c]);
        }
      }
    }
    layer[n] = depth + 1;
  });

  /** @type {Map<number, string[]>} */
  const by_step = new Map();
  for (const id of nodes) {
    if (id === focus) {
      continue;
    }
    const step = layer[Number(comp_of.get(id))];
    const list = by_step.get(step) ?? [];
    list.push(id);
    by_step.set(step, list);
  }
  const cmp = byPriority(index);
  /** @type {WorkStep[]} */
  const steps = Array.from(by_step.keys())
    .sort((a, b) => a - b)
    .map((step, n) => ({
      step: n + 1,
      items: (by_step.get(step) ?? []).sort(cmp).map((id) => ({
        id,
        state: nodeState(index, id),
        reasons: (index.unlocks_of.get(id) ?? []).filter(
          (l) => in_plan.has(l.id) && counts(l.id, l)
        )
      }))
    }));

  return {
    focus,
    goal,
    goal_step: steps.length + 1,
    goal_state: nodeState(index, focus),
    steps,
    total: nodes.length - 1,
    has_cycle: nodes.some((id) => index.cycle_of.has(id))
  };
}

/**
 * What closing the focus unlocks. `immediate` holds the beads that become
 * unblocked right after it, and each later wave assumes that every earlier
 * bead which can then close has closed.
 * - A dependent reached through a blocks or inherited link is unlocked when
 *   no open blocks or inherited prerequisite remains (it can start); one
 *   reached only as a container is unlocked when nothing at all remains (it
 *   can close). External prerequisites do not hold anything back.
 * - An unlocked bead counts as closed for the next wave only once all of its
 *   prerequisites, children included, have closed.
 * - A bead whose every link is inherited through a container in the same
 *   wave is folded under that container.
 * - `still_waiting` lists the reached beads that never unlock, with
 *   `waits_on` naming the open prerequisites they still need.
 *
 * @param {DepIndex} index
 * @param {string} focus
 * @returns {Unlocks}
 */
export function computeUnlocks(index, focus) {
  const done = new Set([focus]);
  /** @type {Set<string>} Beads already placed in a wave. */
  const listed = new Set();
  /** @type {Map<string, DepLink[]>} Reached id to the links that reach it. */
  const reached = new Map();
  /** @type {string[][]} */
  const waves = [];

  /**
   * Open known prerequisites not yet closed in the simulation.
   *
   * @param {string} id
   * @param {boolean} start_only - Leave out children.
   */
  const open_prereqs = (id, start_only) =>
    (index.prereqs_of.get(id) ?? [])
      .filter(
        (l) =>
          !done.has(l.id) &&
          index.entries.has(l.id) &&
          (!start_only || l.reason !== 'child')
      )
      .map((l) => l.id);
  /** @param {string} id */
  const remaining = (id) =>
    open_prereqs(
      id,
      (reached.get(id) ?? []).some((l) => l.reason !== 'child')
    );

  /** @type {Set<string>} */
  const expanded = new Set();
  let pending = [focus];
  let progress = true;
  while (progress) {
    for (const p of pending) {
      if (expanded.has(p)) {
        continue;
      }
      expanded.add(p);
      for (const link of index.unlocks_of.get(p) ?? []) {
        if (done.has(link.id) || listed.has(link.id)) {
          continue;
        }
        const list = reached.get(link.id) ?? [];
        list.push({ id: p, reason: link.reason, via: link.via });
        reached.set(link.id, list);
      }
    }
    const wave = Array.from(reached.keys())
      .filter((id) => !listed.has(id) && remaining(id).length === 0)
      .sort(cmpStr);
    for (const id of wave) {
      listed.add(id);
    }
    if (wave.length > 0) {
      waves.push(wave);
    }
    /** @type {string[]} */
    const closed_now = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of Array.from(listed).sort(cmpStr)) {
        if (!done.has(id) && open_prereqs(id, false).length === 0) {
          done.add(id);
          closed_now.push(id);
          changed = true;
        }
      }
    }
    progress = wave.length > 0 || closed_now.length > 0;
    pending = [...wave, ...closed_now];
  }

  const cmp = byPriority(index);
  /**
   * @param {string[]} wave
   * @returns {UnlockGroup[]}
   */
  const group = (wave) => {
    const in_wave = new Set(wave);
    /** @type {Map<string, string[]>} */
    const folded = new Map();
    /** @type {string[]} */
    const tops = [];
    for (const id of wave) {
      const links = reached.get(id) ?? [];
      const vias = links.every(
        (l) => l.reason === 'inherited' && l.via !== null && in_wave.has(l.via)
      )
        ? links.map((l) => String(l.via)).sort(cmpStr)
        : [];
      if (vias.length > 0) {
        const list = folded.get(vias[0]) ?? [];
        list.push(id);
        folded.set(vias[0], list);
      } else {
        tops.push(id);
      }
    }
    return tops.sort(cmp).map((id) => ({
      id,
      reasons: (reached.get(id) ?? []).slice().sort(cmpLink),
      folded: (folded.get(id) ?? []).sort(cmp)
    }));
  };

  const groups = waves.map(group);
  return {
    focus,
    immediate: groups[0] ?? [],
    waves: groups.slice(1),
    still_waiting: Array.from(reached.keys())
      .filter((id) => !listed.has(id))
      .sort(cmp)
      .map((id) => ({ id, waits_on: remaining(id).sort(cmpStr) })),
    total: listed.size
  };
}

/**
 * Size of the transitive closure from an id over a link map, excluding it.
 *
 * @param {Map<string, DepLink[]>} links_of
 * @param {string} id
 */
function reachCount(links_of, id) {
  const queue = [id];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const link of links_of.get(queue[i]) ?? []) {
      if (!seen.has(link.id)) {
        seen.add(link.id);
        queue.push(link.id);
      }
    }
  }
  seen.delete(id);
  return seen.size;
}

/**
 * Suggestions for a graph with no focus. `start_here` lists beads that can
 * start now and unlock others, ranked by how many beads are downstream;
 * `most_blocked` lists open beads ranked by how many prerequisites are
 * upstream. Ties go by priority, then id.
 *
 * @param {DepIndex} index
 * @param {{ limit?: number }} [options]
 * @returns {Suggestions}
 */
export function computeSuggestions(index, options = {}) {
  const limit = options.limit ?? SUGGESTION_LIMIT;
  const cmp = byPriority(index);
  const start_here = index.ids
    .filter((id) => canStart(index, id))
    .map((id) => ({ id, downstream: reachCount(index.unlocks_of, id) }))
    .filter((s) => s.downstream > 0)
    .sort((a, b) => b.downstream - a.downstream || cmp(a.id, b.id))
    .slice(0, limit);
  const most_blocked = index.ids
    .filter((id) => !isDoneStatus(index.entries.get(id)?.status))
    .map((id) => ({ id, upstream: reachCount(index.prereqs_of, id) }))
    .filter((s) => s.upstream > 0)
    .sort((a, b) => b.upstream - a.upstream || cmp(a.id, b.id))
    .slice(0, limit);
  return { start_here, most_blocked };
}

/**
 * Links toward prerequisites for a slice. With `include_closed`, raw
 * blockers and children are added where either end is done.
 *
 * @param {DepIndex} index
 * @param {string} id
 * @param {boolean} include_closed
 * @returns {DepLink[]}
 */
function sliceUpLinks(index, id, include_closed) {
  const base = index.prereqs_of.get(id) ?? [];
  const entry = index.entries.get(id);
  if (!include_closed || !entry) {
    return base;
  }
  /** @param {string} other */
  const either_closed = (other) =>
    isDoneStatus(entry.status) ||
    isDoneStatus(index.entries.get(other)?.status);
  /** @type {DepLink[]} */
  const extra = [];
  for (const b of entry.blockers) {
    if (index.entries.has(b) && either_closed(b)) {
      extra.push({ id: b, reason: 'blocks', via: null });
    }
  }
  for (const c of entry.children) {
    if (either_closed(c)) {
      extra.push({ id: c, reason: 'child', via: null });
    }
  }
  return [...base, ...extra].sort(cmpLink);
}

/**
 * Links toward dependents for a slice; the inverse of `sliceUpLinks`.
 *
 * @param {DepIndex} index
 * @param {string} id
 * @param {boolean} include_closed
 * @returns {DepLink[]}
 */
function sliceDownLinks(index, id, include_closed) {
  const base = index.unlocks_of.get(id) ?? [];
  const entry = index.entries.get(id);
  if (!include_closed || !entry) {
    return base;
  }
  /** @param {string} other */
  const either_closed = (other) =>
    isDoneStatus(entry.status) ||
    isDoneStatus(index.entries.get(other)?.status);
  /** @type {DepLink[]} */
  const extra = [];
  for (const d of entry.dependents) {
    if (either_closed(d)) {
      extra.push({ id: d, reason: 'blocks', via: null });
    }
  }
  if (
    entry.parent !== null &&
    index.entries.has(entry.parent) &&
    either_closed(entry.parent)
  ) {
    extra.push({ id: entry.parent, reason: 'child', via: null });
  }
  return [...base, ...extra].sort(cmpLink);
}

/**
 * One slice at a fixed depth limit.
 *
 * @param {DepIndex} index
 * @param {string} focus
 * @param {number} depth
 * @param {boolean} include_closed
 * @param {Set<string>} expanded
 */
function sliceAtDepth(index, focus, depth, include_closed, expanded) {
  /** @type {Map<string, number>} */
  const column = new Map([[focus, 0]]);
  /** @type {Array<{ column: number, ids: string[] }>} */
  const overflow = [];
  /** @type {Map<string, string[]>} */
  const folded = new Map();
  const cmp = byPriority(index);
  /** @param {string} id */
  const expandable = (id) =>
    id === focus ||
    (index.entries.has(id) && !isDoneStatus(index.entries.get(id)?.status));

  let frontier = [focus];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    /** @type {Set<string>} */
    const next = new Set();
    for (const n of frontier) {
      if (!expandable(n)) {
        continue;
      }
      for (const link of sliceUpLinks(index, n, include_closed)) {
        if (!column.has(link.id)) {
          next.add(link.id);
        }
      }
    }
    let ids = Array.from(next).sort(cmp);
    if (level === 1 && ids.length > MAX_COLUMN_NODES) {
      overflow.push({
        column: -level,
        ids: ids.slice(MAX_COLUMN_NODES).sort(cmpStr)
      });
      ids = ids.slice(0, MAX_COLUMN_NODES);
    }
    for (const id of ids) {
      column.set(id, -level);
    }
    frontier = ids;
  }

  frontier = [focus];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    /** @type {Map<string, DepLink[]>} */
    const reached = new Map();
    for (const n of frontier) {
      if (!expandable(n)) {
        continue;
      }
      for (const link of sliceDownLinks(index, n, include_closed)) {
        if (column.has(link.id)) {
          continue;
        }
        const list = reached.get(link.id) ?? [];
        list.push({ id: n, reason: link.reason, via: link.via });
        reached.set(link.id, list);
      }
    }
    /** @type {string[]} */
    let visible = [];
    /** @type {Map<string, string>} */
    const fold_under = new Map();
    for (const id of Array.from(reached.keys()).sort(cmp)) {
      const links = reached.get(id) ?? [];
      const foldable = links.every(
        (l) =>
          l.reason === 'inherited' &&
          l.via !== null &&
          !expanded.has(l.via) &&
          (column.has(l.via) || reached.has(l.via))
      );
      if (foldable) {
        fold_under.set(id, links.map((l) => String(l.via)).sort(cmpStr)[0]);
      } else {
        visible.push(id);
      }
    }
    /** @type {string[]} */
    const hidden = [];
    if (level === 1 && visible.length > MAX_COLUMN_NODES) {
      hidden.push(...visible.slice(MAX_COLUMN_NODES));
      visible = visible.slice(0, MAX_COLUMN_NODES);
    }
    for (const id of visible) {
      column.set(id, level);
    }
    for (const [id, via] of fold_under) {
      if (column.has(via)) {
        const list = folded.get(via) ?? [];
        list.push(id);
        folded.set(via, list);
      } else {
        hidden.push(id);
      }
    }
    if (hidden.length > 0) {
      overflow.push({ column: level, ids: hidden.sort(cmpStr) });
    }
    frontier = visible;
  }

  /** @param {string} id */
  const not_drawn = (id) => !column.has(id);
  const overflow_left = overflow
    .map((o) => ({ column: o.column, ids: o.ids.filter(not_drawn) }))
    .filter((o) => o.ids.length > 0);
  for (const [via, ids] of folded) {
    const left = ids.filter(not_drawn);
    if (left.length > 0) {
      folded.set(via, left);
    } else {
      folded.delete(via);
    }
  }

  const node_ids = Array.from(column.keys()).sort(cmpStr);
  /** @type {SliceNode[]} */
  const nodes = node_ids.map((id) => ({
    id,
    column: Number(column.get(id)),
    state: nodeState(index, id),
    focus: id === focus
  }));

  /** @type {SliceEdge[]} */
  const edges = [];
  for (const to of node_ids) {
    for (const link of sliceUpLinks(index, to, include_closed)) {
      if (!column.has(link.id)) {
        continue;
      }
      const ca = index.cycle_of.get(link.id);
      edges.push({
        from: link.id,
        to,
        kind: link.reason,
        via: link.via,
        implied:
          link.reason === 'inherited' &&
          link.via !== null &&
          column.has(link.via),
        cycle: ca !== undefined && ca === index.cycle_of.get(to)
      });
    }
    for (const ref of index.entries.get(to)?.related ?? []) {
      if (ref.direction === 'out' && column.has(ref.id)) {
        edges.push({
          from: ref.id,
          to,
          kind: 'related',
          via: null,
          implied: false,
          cycle: false
        });
      }
    }
  }
  edges.sort(
    (a, b) =>
      cmpStr(a.from, b.from) || cmpStr(a.to, b.to) || cmpStr(a.kind, b.kind)
  );

  const reached_depth = Math.max(...nodes.map((n) => Math.abs(n.column)));
  return {
    nodes,
    edges,
    overflow: overflow_left.sort((a, b) => a.column - b.column),
    folded: Array.from(folded.keys())
      .sort(cmpStr)
      .map((id) => ({ id, ids: (folded.get(id) ?? []).sort(cmpStr) })),
    reached_depth
  };
}

/**
 * The part of the graph around a focus, as layout columns: prerequisites at
 * negative columns, the focus at 0 and unlocks at positive columns. A node
 * reached both ways keeps its prerequisite column. `depth` is the depth limit
 * used (Infinity for all) and `reached_depth` the deepest column present.
 * - The depth is lowered one level at a time while the slice holds more than
 *   MAX_GRAPH_NODES nodes, and `truncated` reports it.
 * - Each depth-1 column keeps its first MAX_COLUMN_NODES nodes by priority;
 *   the rest are listed in `overflow`.
 * - An unlocked bead whose every link is inherited through a container on
 *   the canvas is folded under it unless the container is in `expanded`.
 * - Inherited edges are `implied` when their `via` node is on the canvas, so
 *   the view does not draw them.
 * - An id a deeper level draws is dropped from `overflow` and `folded`, so
 *   it is counted once.
 * - `include_closed` adds done (closed or pinned) neighbours as leaves; a
 *   done focus is still expanded.
 *
 * @param {DepIndex} index
 * @param {string} focus
 * @param {{ max_depth?: number, include_closed?: boolean, expanded?: Iterable<string> }} [options]
 * @returns {GraphSlice}
 */
export function collectGraphSlice(index, focus, options = {}) {
  const requested = Math.max(1, options.max_depth ?? Infinity);
  const include_closed = options.include_closed === true;
  const expanded = new Set(options.expanded ?? []);
  let depth = requested;
  let slice = sliceAtDepth(index, focus, depth, include_closed, expanded);
  let truncated = false;
  while (slice.nodes.length > MAX_GRAPH_NODES && slice.reached_depth > 1) {
    depth = slice.reached_depth - 1;
    truncated = true;
    slice = sliceAtDepth(index, focus, depth, include_closed, expanded);
  }
  return {
    focus,
    depth,
    reached_depth: slice.reached_depth,
    requested_depth: requested,
    truncated,
    nodes: slice.nodes,
    edges: slice.edges,
    overflow: slice.overflow,
    folded: slice.folded
  };
}

/**
 * Focus picker matches by id or title, case-insensitive. Ranked exact id,
 * id prefix, title prefix, id substring, then title substring; ties put open
 * beads first, then priority, then id. An empty query matches nothing.
 *
 * @param {DepIndex} index
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {DepIndexEntry[]}
 */
export function searchFocusCandidates(index, query, options = {}) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const limit = options.limit ?? SEARCH_RESULT_LIMIT;
  const cmp = byPriority(index);
  /** @type {Array<{ entry: DepIndexEntry, rank: number }>} */
  const hits = [];
  for (const entry of index.entries.values()) {
    const id = entry.id.toLowerCase();
    const title = (entry.issue.title ?? '').toLowerCase();
    const rank =
      id === q
        ? RANK_EXACT_ID
        : id.startsWith(q)
          ? RANK_ID_PREFIX
          : title.startsWith(q)
            ? RANK_TITLE_PREFIX
            : id.includes(q)
              ? RANK_ID_SUBSTRING
              : title.includes(q)
                ? RANK_TITLE_SUBSTRING
                : -1;
    if (rank >= 0) {
      hits.push({ entry, rank });
    }
  }
  /** @param {DepIndexEntry} e */
  const closed = (e) => (isDoneStatus(e.status) ? 1 : 0);
  return hits
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        closed(a.entry) - closed(b.entry) ||
        cmp(a.entry.id, b.entry.id)
    )
    .slice(0, limit)
    .map((h) => h.entry);
}

/**
 * Cycles in the prerequisite graph: every multi-member strongly connected
 * component and every self-loop (such as a child blocking its own parent),
 * members sorted, cycles sorted by first member.
 *
 * @param {DepIndex} index
 * @returns {string[][]}
 */
export function findCycles(index) {
  return index.cycles.map((c) => c.slice());
}

/**
 * Whether a bead takes part in ordering, for the board's graph button and the
 * detail dialog's graph link. Parent-child-only relations do not count.
 * An index entry also counts inherited relations; a row counts its own
 * ordering edges in `dependencies` and, in the detail shape, `dependents`.
 *
 * @param {DepIssue | DepIndexEntry} issue_or_entry
 */
export function hasOrderingRelations(issue_or_entry) {
  if (!issue_or_entry || typeof issue_or_entry !== 'object') {
    return false;
  }
  if ('has_ordering' in issue_or_entry) {
    return issue_or_entry.has_ordering;
  }
  /** @param {DepEdgeInput[] | undefined} edges */
  const ordering = (edges) =>
    Array.isArray(edges) &&
    edges.some(
      (e) => e && ORDERING_TYPE_SET.has(edgeType(e)) && edgeTarget(e) !== ''
    );
  return (
    ordering(issue_or_entry.dependencies) || ordering(issue_or_entry.dependents)
  );
}

/**
 * Direct bd blockers of every row: targets of `blocks` edges that are in the
 * open set.
 *
 * @param {Map<string, DepIssue>} open
 * @returns {Map<string, string[]>}
 */
function bdDirectBlockers(open) {
  /** @type {Map<string, string[]>} */
  const direct = new Map();
  for (const [id, row] of open) {
    /** @type {Set<string>} */
    const targets = new Set();
    for (const edge of edgesOf(row)) {
      const target = edgeTarget(edge);
      if (edgeType(edge) === BD_BLOCKING_DEP_TYPE && open.has(target)) {
        targets.add(target);
      }
    }
    direct.set(id, Array.from(targets).sort(cmpStr));
  }
  return direct;
}

/**
 * The bd 0.63.3 `bd blocked` set, derived from the open set (every
 * non-closed, non-pinned bead). X is blocked when a `blocks` edge names an
 * open-set bead, or when its parent is in the open set and has such an edge
 * (one level only, whatever the statuses). `blocked_by` is X's own blockers
 * when it has any, otherwise `[parent]`; several own blockers are sorted by
 * id since bd's order was not captured.
 *
 * @param {DepIssue[]} rows - The open set.
 * @returns {Array<{ id: string, blocked_by: string[] }>} Sorted by id.
 */
export function deriveBdBlocked(rows) {
  const open = mergeRows(Array.isArray(rows) ? rows : []);
  const direct = bdDirectBlockers(open);
  /** @type {Array<{ id: string, blocked_by: string[] }>} */
  const out = [];
  for (const [id, row] of sortedById(open)) {
    const own = direct.get(id) ?? [];
    const parent = parentOf(row);
    if (own.length > 0) {
      out.push({ id, blocked_by: own });
    } else if (
      parent !== null &&
      open.has(parent) &&
      (direct.get(parent) ?? []).length > 0
    ) {
      out.push({ id, blocked_by: [parent] });
    }
  }
  return out;
}

/**
 * The bd 0.63.3 `bd ready` ids, derived from the open set: status exactly
 * `open`, not in the blocked set, not ephemeral, and `defer_until` absent or
 * not after `now_ms`. An unparseable `defer_until` is ignored.
 * bd 0.63.3 writes `defer_until` as local wall-clock time with a `Z` suffix;
 * the value is compared as written (as UTC), which matches the captured
 * fixture, so within the host's UTC offset of the boundary the result can
 * differ from bd.
 *
 * @param {DepIssue[]} rows - The open set.
 * @param {number} now_ms - Current time in epoch ms.
 * @returns {string[]} Sorted ids.
 */
export function deriveBdReadyIds(rows, now_ms) {
  const open = mergeRows(Array.isArray(rows) ? rows : []);
  const blocked = new Set(
    deriveBdBlocked(Array.from(open.values())).map((b) => b.id)
  );
  return Array.from(open.values())
    .filter((row) => {
      if (row.status !== BD_READY_STATUS || blocked.has(row.id)) {
        return false;
      }
      if (row.ephemeral === true) {
        return false;
      }
      if (typeof row.defer_until !== 'string' || row.defer_until === '') {
        return true;
      }
      const defer_ms = Date.parse(row.defer_until);
      return Number.isNaN(defer_ms) || defer_ms <= now_ms;
    })
    .map((row) => row.id)
    .sort(cmpStr);
}
