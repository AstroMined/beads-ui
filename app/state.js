/**
 * Minimal app state store with subscription.
 */
import { debug } from './utils/logging.js';
import { MAX_PRIORITY, MIN_PRIORITY } from './utils/priority.js';

/**
 * @typedef {'all'|'open'|'in_progress'|'closed'|'ready'} StatusFilter
 */

/**
 * @typedef {{ status: StatusFilter, search: string, type: string }} Filters
 */

/** All top-level views, in navigation order. */
export const VIEW_NAMES = /** @type {const} */ ([
  'issues',
  'epics',
  'board',
  'graph',
  'settings'
]);

/**
 * @typedef {typeof VIEW_NAMES[number]} ViewName
 */

/**
 * @typedef {'today'|'3'|'7'} ClosedFilter
 */

/**
 * Board filters. Arrays are deduped and sorted so equal content compares
 * equal regardless of selection order.
 *
 * @typedef {{ parent: string|null, assignee: string|null, types: string[], priorities: number[], labels: string[] }} BoardFilters
 */

/**
 * @typedef {{ closed_filter: ClosedFilter, board_filters: BoardFilters }} BoardState
 */

/**
 * Graph view state. The focus lives in the hash, so it is not persisted.
 *
 * @typedef {{ focus_id: string|null }} GraphState
 */

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} path - Full path to workspace
 * @property {string} database - Path to the database file
 * @property {number} [pid] - Process ID of the daemon
 * @property {string} [version] - Version of beads
 */

/**
 * @typedef {Object} WorkspaceState
 * @property {WorkspaceInfo | null} current - Currently active workspace
 * @property {WorkspaceInfo[]} available - All available workspaces
 */

/**
 * @typedef {{ selected_id: string | null, view: ViewName, filters: Filters, board: BoardState, graph: GraphState, workspace: WorkspaceState }} AppState
 */

/**
 * @typedef {{ selected_id?: string | null, view?: ViewName, filters?: Partial<Filters>, board?: { closed_filter?: ClosedFilter, board_filters?: Partial<BoardFilters> }, graph?: Partial<GraphState>, workspace?: Partial<WorkspaceState> }} StatePatch
 */

/**
 * Initial state. Board filters may be any persisted value; they are
 * normalized on creation.
 *
 * @typedef {{ selected_id?: string | null, view?: ViewName, filters?: Partial<Filters>, board?: { closed_filter?: ClosedFilter, board_filters?: unknown }, graph?: Partial<GraphState>, workspace?: Partial<WorkspaceState> }} StateInit
 */

/**
 * Check whether a value names a known view.
 *
 * @param {unknown} value
 * @returns {value is ViewName}
 */
export function isViewName(value) {
  return VIEW_NAMES.some((name) => name === value);
}

/**
 * Create board filters with nothing selected.
 *
 * @returns {BoardFilters}
 */
export function createEmptyBoardFilters() {
  return {
    parent: null,
    assignee: null,
    types: [],
    priorities: [],
    labels: []
  };
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function toNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Keep the non-empty strings of an array, deduped and sorted.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of value) {
    const str = toNonEmptyString(item);
    if (str !== null) {
      seen.add(str);
    }
  }
  return Array.from(seen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Keep the integer priorities in range, deduped and sorted ascending.
 *
 * @param {unknown} value
 * @returns {number[]}
 */
function toPriorityList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Set<number>} */
  const seen = new Set();
  for (const item of value) {
    if (
      typeof item === 'number' &&
      Number.isInteger(item) &&
      item >= MIN_PRIORITY &&
      item <= MAX_PRIORITY
    ) {
      seen.add(item);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Coerce any value (persisted JSON, a merged patch) into valid board
 * filters. A legacy single `type` string becomes `types: [type]` when no
 * `types` array is present; invalid values are dropped.
 *
 * @param {unknown} value
 * @returns {BoardFilters}
 */
export function normalizeBoardFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyBoardFilters();
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  const legacy_type = toNonEmptyString(obj.type);
  const types =
    Array.isArray(obj.types) || legacy_type === null
      ? obj.types
      : [legacy_type];
  return {
    parent: toNonEmptyString(obj.parent),
    assignee: toNonEmptyString(obj.assignee),
    types: toStringList(types),
    priorities: toPriorityList(obj.priorities),
    labels: toStringList(obj.labels)
  };
}

/**
 * @template T
 * @param {T[]} a
 * @param {T[]} b
 */
function listsEqual(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Compare two normalized board filters by content.
 *
 * @param {BoardFilters} a
 * @param {BoardFilters} b
 * @returns {boolean}
 */
export function boardFiltersEqual(a, b) {
  return (
    a.parent === b.parent &&
    a.assignee === b.assignee &&
    listsEqual(a.types, b.types) &&
    listsEqual(a.priorities, b.priorities) &&
    listsEqual(a.labels, b.labels)
  );
}

/**
 * Check whether any board filter narrows the board.
 *
 * @param {BoardFilters} filters
 * @returns {boolean}
 */
export function hasActiveBoardFilters(filters) {
  return (
    filters.parent !== null ||
    filters.assignee !== null ||
    filters.types.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labels.length > 0
  );
}

/**
 * Create a simple store for application state.
 *
 * @param {StateInit} [initial]
 * @returns {{ getState: () => AppState, setState: (patch: StatePatch) => void, subscribe: (fn: (s: AppState) => void) => () => void }}
 */
export function createStore(initial = {}) {
  const log = debug('state');
  /** @type {AppState} */
  let state = {
    selected_id: initial.selected_id ?? null,
    view: initial.view ?? 'issues',
    filters: {
      status: initial.filters?.status ?? 'all',
      search: initial.filters?.search ?? '',
      type:
        typeof initial.filters?.type === 'string' ? initial.filters?.type : ''
    },
    board: {
      closed_filter:
        initial.board?.closed_filter === '3' ||
        initial.board?.closed_filter === '7' ||
        initial.board?.closed_filter === 'today'
          ? initial.board?.closed_filter
          : 'today',
      board_filters: normalizeBoardFilters(initial.board?.board_filters)
    },
    graph: {
      focus_id: toNonEmptyString(initial.graph?.focus_id)
    },
    workspace: {
      current: initial.workspace?.current ?? null,
      available: initial.workspace?.available ?? []
    }
  };

  /** @type {Set<(s: AppState) => void>} */
  const subs = new Set();

  function emit() {
    for (const fn of Array.from(subs)) {
      try {
        fn(state);
      } catch {
        // ignore
      }
    }
  }

  return {
    getState() {
      return state;
    },
    /**
     * Update state. Nested filters can be partial.
     *
     * @param {StatePatch} patch
     */
    setState(patch) {
      const merged_board_filters = patch.board?.board_filters
        ? normalizeBoardFilters({
            ...state.board.board_filters,
            ...patch.board.board_filters
          })
        : state.board.board_filters;
      const board_filters_changed = !boardFiltersEqual(
        merged_board_filters,
        state.board.board_filters
      );
      /** @type {AppState} */
      const next = {
        ...state,
        ...patch,
        filters: { ...state.filters, ...(patch.filters || {}) },
        board: {
          ...state.board,
          ...(patch.board || {}),
          // Keep the previous reference when content is unchanged
          board_filters: board_filters_changed
            ? merged_board_filters
            : state.board.board_filters
        },
        graph: {
          focus_id:
            patch.graph?.focus_id !== undefined
              ? toNonEmptyString(patch.graph.focus_id)
              : state.graph.focus_id
        },
        workspace: {
          current:
            patch.workspace?.current !== undefined
              ? patch.workspace.current
              : state.workspace.current,
          available:
            patch.workspace?.available !== undefined
              ? patch.workspace.available
              : state.workspace.available
        }
      };
      // Avoid emitting if nothing changed (shallow compare)
      const workspace_changed =
        next.workspace.current?.path !== state.workspace.current?.path ||
        next.workspace.current?.database !==
          state.workspace.current?.database ||
        next.workspace.available.length !== state.workspace.available.length ||
        JSON.stringify(next.workspace.available.map((w) => w.path)) !==
          JSON.stringify(state.workspace.available.map((w) => w.path));
      if (
        next.selected_id === state.selected_id &&
        next.view === state.view &&
        next.filters.status === state.filters.status &&
        next.filters.search === state.filters.search &&
        next.filters.type === state.filters.type &&
        next.board.closed_filter === state.board.closed_filter &&
        !board_filters_changed &&
        next.graph.focus_id === state.graph.focus_id &&
        !workspace_changed
      ) {
        return;
      }
      state = next;
      log('state change %o', {
        selected_id: state.selected_id,
        view: state.view,
        filters: state.filters,
        board: state.board,
        graph: state.graph,
        workspace: state.workspace.current?.path
      });
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}
