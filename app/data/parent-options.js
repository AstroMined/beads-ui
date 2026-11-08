/**
 * Parent picker options for the Board: the ancestors of the on-board items,
 * flattened into tree order with their depth.
 */
import { ancestorIds } from './dep-graph.js';

/**
 * One row of the Parent picker. `parent` is the row's parent within the
 * option tree, or null for a root. `known` is false for an id that only
 * appears as some row's parent and has no row of its own.
 *
 * @typedef {{
 *   id: string,
 *   parent: string | null,
 *   depth: number,
 *   title: string,
 *   issue_type: string,
 *   status: string,
 *   known: boolean
 * }} ParentOption
 */

/** Orders ids by their digit runs as numbers, so `.2` sorts before `.10`. */
const ID_COLLATOR = new Intl.Collator('en', { numeric: true });

/**
 * Compare two ids with numeric segments compared as numbers. Ids that the
 * collator considers equal fall back to code-unit order, so the result is a
 * total order.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareIdsNatural(a, b) {
  return ID_COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * List every ancestor of the given items in tree order: each row is followed
 * by its descendants, depth first, with siblings in natural id order. The
 * items themselves appear only when they are an ancestor of another item.
 *
 * @param {import('./dep-graph.js').DepIndex} index
 * @param {Iterable<string>} item_ids - Ids of the items on the board.
 * @returns {ParentOption[]}
 */
export function flattenParentOptions(index, item_ids) {
  /** @type {Set<string>} */
  const members = new Set();
  for (const id of item_ids) {
    for (const ancestor of ancestorIds(index, id)) {
      members.add(ancestor);
    }
  }

  /** @type {Map<string, string>} */
  const tree_parent = new Map();
  /** @type {Map<string, string[]>} */
  const children = new Map();
  /** @type {string[]} */
  const roots = [];
  for (const id of members) {
    const parent = index.entries.get(id)?.parent ?? null;
    if (parent !== null && parent !== id && members.has(parent)) {
      tree_parent.set(id, parent);
      const list = children.get(parent) ?? [];
      list.push(id);
      children.set(parent, list);
    } else {
      roots.push(id);
    }
  }
  for (const list of children.values()) {
    list.sort(compareIdsNatural);
  }
  roots.sort(compareIdsNatural);

  /** @type {ParentOption[]} */
  const out = [];
  /** @type {Set<string>} */
  const visited = new Set();

  /**
   * Append `root` and its subtree, depth first.
   *
   * @param {string} root
   */
  function walk(root) {
    /** @type {Array<{ id: string, depth: number }>} */
    const stack = [{ id: root, depth: 0 }];
    while (stack.length > 0) {
      const { id, depth } = /** @type {{ id: string, depth: number }} */ (
        stack.pop()
      );
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      const entry = index.entries.get(id);
      out.push({
        id,
        parent: depth === 0 ? null : (tree_parent.get(id) ?? null),
        depth,
        title: entry?.issue.title ?? '',
        issue_type: entry?.issue.issue_type ?? '',
        status: entry?.status ?? '',
        known: entry !== undefined
      });
      const kids = children.get(id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push({ id: kids[i], depth: depth + 1 });
      }
    }
  }

  for (const root of roots) {
    walk(root);
  }
  // Members on a parent cycle have no root; list each cycle from its
  // smallest id so none is dropped.
  for (const id of Array.from(members).sort(compareIdsNatural)) {
    if (!visited.has(id)) {
      walk(id);
    }
  }
  return out;
}

/**
 * Keep the options whose id or title contains the query, ignoring case, plus
 * every ancestor of a match so the tree stays readable. An empty query keeps
 * every option.
 *
 * @param {ParentOption[]} options - Rows from `flattenParentOptions`.
 * @param {string} query
 * @returns {ParentOption[]}
 */
export function filterParentOptions(options, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return options.slice();
  }
  /** @type {Map<string, ParentOption>} */
  const by_id = new Map(options.map((o) => [o.id, o]));
  /** @type {Set<string>} */
  const keep = new Set();
  for (const option of options) {
    if (
      !option.id.toLowerCase().includes(needle) &&
      !option.title.toLowerCase().includes(needle)
    ) {
      continue;
    }
    /** @type {ParentOption | undefined} */
    let current = option;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parent === null ? undefined : by_id.get(current.parent);
    }
  }
  return options.filter((o) => keep.has(o.id));
}
