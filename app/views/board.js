import { html, nothing, render } from 'lit-html';
import {
  ancestorIds,
  buildDepIndex,
  hasOrderingRelations
} from '../data/dep-graph.js';
import { BOARD_INDEX_CLIENT_ID } from '../data/graph-subscription.js';
import { createListSelectors } from '../data/list-selectors.js';
import {
  filterParentOptions,
  flattenParentOptions
} from '../data/parent-options.js';
import { cmpClosedDesc, cmpPriorityThenCreated } from '../data/sort.js';
import {
  createEmptyBoardFilters,
  hasActiveBoardFilters,
  normalizeBoardFilters
} from '../state.js';
import { createIssueIdRenderer } from '../utils/issue-id-renderer.js';
import { ISSUE_TYPES, typeLabel } from '../utils/issue-type.js';
import { debug } from '../utils/logging.js';
import { createPriorityBadge } from '../utils/priority-badge.js';
import {
  DEFAULT_PRIORITY,
  MAX_PRIORITY,
  MIN_PRIORITY,
  priority_levels
} from '../utils/priority.js';
import { showToast } from '../utils/toast.js';
import { createTypeBadge } from '../utils/type-badge.js';
import {
  createFilterDropdownController,
  multiSelectDropdownTemplate
} from './filter-dropdown.js';

/** Prefix for the filter dropdown menu ids referenced by `aria-controls`. */
const FILTER_ID_PREFIX = 'board-filter';

/** Dropdown keys, rendered as `data-filter`. */
const PARENT_KEY = 'parent';
const TYPES_KEY = 'types';
const PRIORITIES_KEY = 'priorities';
const LABELS_KEY = 'labels';
const COLUMNS_KEY = 'columns';

const PARENT_MENU_ID = `${FILTER_ID_PREFIX}-${PARENT_KEY}-menu`;

/** Key that opens the focused card in the Graph tab. */
const GRAPH_KEY = 'g';

/** Known issue types, listed before any unknown type found on the board. */
const KNOWN_TYPE_OPTIONS = ISSUE_TYPES.map((t) => ({
  value: t,
  label: typeLabel(t)
}));

/** Priority options, `P0 Critical` to `P4 Backlog`. */
const PRIORITY_OPTIONS = priority_levels
  .slice(MIN_PRIORITY, MAX_PRIORITY + 1)
  .map((name, i) => ({
    value: String(MIN_PRIORITY + i),
    label: `P${MIN_PRIORITY + i} ${name}`
  }));

/**
 * Calculate the minimum column width for a responsive board grid.
 *
 * @param {number} viewportWidth - Available viewport or container width in px.
 * @param {number} columnCount - Number of visible columns.
 * @param {number} gapPx - Gap between columns in px (CSS --space-8 = 16).
 * @param {number} paddingPx - Horizontal padding on the board root in px (CSS --space-6 = 12).
 * @returns {number} Minimum column width in px, floored at 180.
 */
export function computeColMinWidth(
  viewportWidth,
  columnCount,
  gapPx,
  paddingPx
) {
  if (columnCount <= 0) {
    return viewportWidth;
  }
  const available = viewportWidth - (columnCount - 1) * gapPx - 2 * paddingPx;
  if (columnCount === 1) {
    return Math.max(180, Math.floor(available));
  }
  return Math.max(180, Math.floor(available / columnCount));
}

/**
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   status?: 'open'|'in_progress'|'closed',
 *   priority?: number,
 *   issue_type?: string,
 *   created_at?: number,
 *   updated_at?: number,
 *   closed_at?: number,
 *   parent?: string,
 *   assignee?: string,
 *   labels?: string[]
 * }} IssueLite
 */

/**
 * Filter choices, always computed from the unfiltered board.
 *
 * @typedef {{
 *   parents: import('../data/parent-options.js').ParentOption[],
 *   assignees: string[],
 *   types: import('./filter-dropdown.js').FilterOption[],
 *   labels: import('./filter-dropdown.js').FilterOption[]
 * }} FilterOptions
 */

/**
 * @typedef {Object} ColumnDef
 * @property {string} id - Unique column identifier.
 * @property {string} label - Display label for the column header.
 * @property {string} subscription - Subscription type for data.
 * @property {Record<string, unknown>} [params] - Optional subscription parameters.
 * @property {string} drop_status - Status to set when a card is dropped.
 * @property {boolean} [is_closed] - True if this column represents closed issues.
 */

/**
 * @typedef {Object} BoardViewOptions
 * @property {HTMLElement} mount_element
 * @property {unknown} [data] - Legacy data layer for fallback fetch.
 * @property {(id: string) => void} gotoIssue - Navigate to issue detail.
 * @property {(id: string) => void} [gotoGraph] - Open an issue in the Graph tab.
 * @property {{ getState: () => any, setState: (patch: any) => void, subscribe?: (fn: (s:any)=>void)=>()=>void }} [store]
 * @property {{ selectors: { getIds: (client_id: string) => string[], count?: (client_id: string) => number } }} [subscriptions]
 * @property {{ snapshotFor?: (client_id: string) => any[], getStore?: (client_id: string) => { snapshot: () => readonly any[] } | null, subscribe?: (fn: () => void) => () => void }} [issueStores]
 * @property {(type: string, payload: unknown) => Promise<unknown>} [transport] - Transport function for sending updates
 * @property {ColumnDef[]} [columns] - Column definitions from settings
 */

/**
 * Whether two lists hold the same entries, by identity, in the same order.
 *
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {boolean}
 */
function sameEntries(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Create the Board view with dynamic columns from settings.
 * Push-only: derives items from per-subscription stores.
 *
 * Sorting rules:
 * - Closed columns: closed_at desc.
 * - All others: priority asc, then created_at asc.
 *
 * @param {BoardViewOptions} options
 * @returns {{ load: () => Promise<void>, clear: () => void }}
 */
export function createBoardView(options) {
  const {
    mount_element,
    data: _data,
    gotoIssue,
    gotoGraph,
    store,
    subscriptions,
    issueStores,
    transport,
    columns
  } = options;
  const log = debug('views:board');

  /** @type {ColumnDef[]} */
  const col_defs = (
    Array.isArray(columns) && columns.length > 0
      ? columns
      : [
          {
            id: 'blocked',
            label: 'Blocked',
            subscription: 'blocked-issues',
            drop_status: 'open',
            is_closed: false
          },
          {
            id: 'ready',
            label: 'Ready',
            subscription: 'ready-issues',
            drop_status: 'open',
            is_closed: false
          },
          {
            id: 'in-progress',
            label: 'In Progress',
            subscription: 'in-progress-issues',
            drop_status: 'in_progress',
            is_closed: false
          },
          {
            id: 'closed',
            label: 'Closed',
            subscription: 'closed-issues',
            drop_status: 'closed',
            is_closed: true
          }
        ]
  ).map((col) => ({
    ...col,
    is_closed: col.is_closed ?? col.subscription === 'closed-issues'
  }));

  // column_raw: closed columns before the closed date filter.
  // column_data: every column after the closed date filter, before the board
  // filters; filter options are computed from it and column_raw.
  // column_view: column_data narrowed by the board filters, as rendered.
  /** @type {Map<string, IssueLite[]>} */
  const column_data = new Map();
  /** @type {Map<string, IssueLite[]>} */
  const column_raw = new Map();
  /** @type {Map<string, IssueLite[]>} */
  const column_view = new Map();
  for (const col of col_defs) {
    column_data.set(col.id, []);
    column_view.set(col.id, []);
    if (col.is_closed) {
      column_raw.set(col.id, []);
    }
  }
  /** Dependency index over the board-index snapshot and the board items. */
  let dep_index = buildDepIndex([]);
  /**
   * What `dep_index` was built from: the board store snapshot arrays, which a
   * push replaces even when an upsert mutates an issue in place, then every
   * index row and board item. Null forces the next rebuild.
   *
   * @type {unknown[] | null}
   */
  let dep_index_inputs = null;
  /** The index `parent_options` was flattened from. */
  let parent_options_index = dep_index;
  /** @type {import('../data/parent-options.js').ParentOption[]} */
  let parent_options = [];
  /** Board filters used when no store is provided. */
  let local_filters = createEmptyBoardFilters();
  /** Search text typed into the Parent picker. */
  let parent_query = '';
  // Filter dropdowns: one open at a time, closed on outside click/Escape
  const dropdowns = createFilterDropdownController({
    onChange: () => doRender()
  });
  // Centralized selection helpers
  const selectors = issueStores ? createListSelectors(issueStores) : null;

  /**
   * Build the localStorage key for column visibility persistence.
   *
   * @returns {string|null} Key string, or null if workspace path unavailable.
   */
  function getVisibilityStorageKey() {
    try {
      const ws_path = store?.getState()?.workspace?.current?.path;
      if (ws_path) {
        return `beads-ui.board-col-vis:${ws_path}`;
      }
    } catch {
      // ignore store errors
    }
    return null;
  }

  /**
   * Reconcile stored visibility state with current column definitions.
   * New columns default to visible; removed columns are pruned.
   *
   * @param {Record<string, boolean>} stored
   * @param {ColumnDef[]} defs
   * @returns {Record<string, boolean>}
   */
  function reconcileVisibility(stored, defs) {
    /** @type {Record<string, boolean>} */
    const result = {};
    for (const col of defs) {
      result[col.id] = col.id in stored ? stored[col.id] : true;
    }
    return result;
  }

  /**
   * Load column visibility from localStorage and reconcile with current col_defs.
   *
   * @returns {Record<string, boolean>}
   */
  function loadVisibility() {
    /** @type {Record<string, boolean>} */
    const defaults = {};
    for (const col of col_defs) {
      defaults[col.id] = true;
    }
    const key = getVisibilityStorageKey();
    if (!key) {
      return defaults;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return defaults;
      }
      return reconcileVisibility(parsed, col_defs);
    } catch {
      return defaults;
    }
  }

  /**
   * Persist current column visibility to localStorage.
   */
  function persistVisibility() {
    const key = getVisibilityStorageKey();
    if (!key) {
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(column_visibility));
    } catch {
      // ignore storage errors
    }
  }

  /**
   * Column visibility state: maps column id to boolean (visible or not).
   * Initialized from localStorage if available, otherwise all visible.
   *
   * @type {Record<string, boolean>}
   */
  let column_visibility = loadVisibility();

  /**
   * Closed column filter mode.
   * 'today' → items with closed_at since local day start
   * '3' → last 3 days; '7' → last 7 days
   *
   * @type {'today'|'3'|'7'}
   */
  let closed_filter_mode = 'today';
  if (store) {
    try {
      const s = store.getState();
      const cf =
        s && s.board ? String(s.board.closed_filter || 'today') : 'today';
      if (cf === 'today' || cf === '3' || cf === '7') {
        closed_filter_mode = /** @type {any} */ (cf);
      }
    } catch {
      // ignore store init errors
    }
  }

  /** @type {FilterOptions} */
  let last_filter_options = {
    parents: [],
    assignees: [],
    types: KNOWN_TYPE_OPTIONS,
    labels: []
  };

  /**
   * Current board filters, normalized so legacy or partial store values
   * (for example a single `type`) read as the multi-valued shape.
   *
   * @returns {import('../state.js').BoardFilters}
   */
  function getFilters() {
    if (!store) {
      return local_filters;
    }
    try {
      return normalizeBoardFilters(store.getState()?.board?.board_filters);
    } catch {
      return createEmptyBoardFilters();
    }
  }

  /**
   * Merge a patch into the board filters, save it and recompute the
   * filtered columns. Callers render once afterwards.
   *
   * @param {Partial<import('../state.js').BoardFilters>} patch
   */
  function updateFilters(patch) {
    const next = normalizeBoardFilters({ ...getFilters(), ...patch });
    if (store) {
      try {
        store.setState({ board: { board_filters: next } });
      } catch {
        // ignore store errors
      }
    } else {
      local_filters = next;
    }
    applyBoardFilters();
  }

  /**
   * Every item on the board before any filter: the raw list of closed
   * columns and the data of the others.
   *
   * @returns {IssueLite[]}
   */
  function boardItems() {
    /** @type {IssueLite[]} */
    const out = [];
    for (const col of col_defs) {
      const items =
        (col.is_closed ? column_raw.get(col.id) : column_data.get(col.id)) ||
        [];
      out.push(...items);
    }
    return out;
  }

  /**
   * Rebuild the dependency index from the board-index snapshot plus the
   * board items. Before that snapshot arrives the board items alone are
   * used, so Parent then matches only ancestors visible on the board.
   */
  function rebuildIndex() {
    const index_rows =
      issueStores && typeof issueStores.snapshotFor === 'function'
        ? issueStores.snapshotFor(BOARD_INDEX_CLIENT_ID)
        : [];
    const rows = [
      ...(Array.isArray(index_rows) ? index_rows : []),
      ...boardItems()
    ];
    const inputs = [...boardStoreSnapshots(), ...rows];
    if (dep_index_inputs !== null && sameEntries(dep_index_inputs, inputs)) {
      return;
    }
    dep_index_inputs = inputs;
    dep_index = buildDepIndex(rows);
  }

  /**
   * Snapshot arrays of the board-index store and every column store, or none
   * when the registry exposes no stores.
   *
   * @returns {Array<readonly unknown[] | null>}
   */
  function boardStoreSnapshots() {
    if (!issueStores || typeof issueStores.getStore !== 'function') {
      return [];
    }
    const get_store = issueStores.getStore.bind(issueStores);
    return [
      BOARD_INDEX_CLIENT_ID,
      ...col_defs.map((col) => 'tab:board:' + col.id)
    ].map((client_id) => get_store(client_id)?.snapshot() ?? null);
  }

  /**
   * Parent picker options for the current index, flattened once per index.
   *
   * @param {IssueLite[]} items - The board items the index was built from.
   * @returns {import('../data/parent-options.js').ParentOption[]}
   */
  function parentOptionsFor(items) {
    if (parent_options_index !== dep_index) {
      parent_options = flattenParentOptions(
        dep_index,
        items.map((it) => it.id)
      );
      parent_options_index = dep_index;
    }
    return parent_options;
  }

  /**
   * Labels of an item: its own plus those of its index entry.
   *
   * @param {IssueLite} it
   * @returns {string[]}
   */
  function labelsOf(it) {
    const own = Array.isArray(it.labels) ? it.labels : [];
    const indexed = dep_index.entries.get(it.id)?.issue.labels;
    return Array.isArray(indexed) ? [...own, ...indexed] : own;
  }

  /**
   * Whether an item can be opened in the Graph tab: a `gotoGraph` handler
   * exists and the item or its index entry takes part in ordering.
   *
   * @param {IssueLite} it
   * @returns {boolean}
   */
  function opensInGraph(it) {
    if (typeof gotoGraph !== 'function') {
      return false;
    }
    const entry = dep_index.entries.get(it.id);
    return (
      hasOrderingRelations(it) || Boolean(entry && hasOrderingRelations(entry))
    );
  }

  /**
   * @param {IssueLite} it
   * @returns {number}
   */
  function priorityOf(it) {
    return typeof it.priority === 'number' ? it.priority : DEFAULT_PRIORITY;
  }

  /**
   * Compute filter options from the unfiltered board, so the lists never
   * shrink when a filter or the closed date filter narrows the view. Current
   * selections stay listed so they can be cleared.
   *
   * @returns {FilterOptions}
   */
  function getFilterOptions() {
    const filters = getFilters();
    const items = boardItems();
    /** @type {Set<string>} */
    const assignees = new Set();
    /** @type {Set<string>} */
    const types = new Set(filters.types);
    /** @type {Set<string>} */
    const labels = new Set(filters.labels);
    for (const it of items) {
      if (it.assignee && typeof it.assignee === 'string') {
        assignees.add(it.assignee);
      }
      if (it.issue_type && typeof it.issue_type === 'string') {
        types.add(it.issue_type);
      }
      for (const label of labelsOf(it)) {
        if (typeof label === 'string' && label.length > 0) {
          labels.add(label);
        }
      }
    }
    if (filters.assignee !== null) {
      assignees.add(filters.assignee);
    }
    /** @type {Set<string>} */
    const known_types = new Set(ISSUE_TYPES);
    const unknown_types = Array.from(types)
      .filter((t) => !known_types.has(t))
      .sort((a, b) => a.localeCompare(b));
    return {
      parents: parentOptionsFor(items),
      assignees: Array.from(assignees).sort((a, b) => a.localeCompare(b)),
      types: [
        ...KNOWN_TYPE_OPTIONS,
        ...unknown_types.map((t) => ({ value: t, label: t }))
      ],
      labels: Array.from(labels)
        .sort((a, b) => a.localeCompare(b))
        .map((l) => ({ value: l, label: l }))
    };
  }

  /**
   * Get the list of visible columns based on column_visibility state.
   *
   * @returns {ColumnDef[]}
   */
  function getVisibleColumns() {
    return col_defs.filter((c) => column_visibility[c.id] !== false);
  }

  /**
   * Toggle visibility for a column, persist, and re-render.
   *
   * @param {string} col_id
   */
  function toggleColumnVisibility(col_id) {
    column_visibility[col_id] = !column_visibility[col_id];
    persistVisibility();
    doRender();
  }

  /**
   * Render the columns visibility dropdown template.
   */
  function columnVisibilityTemplate() {
    const visible_ids = col_defs
      .filter((c) => column_visibility[c.id] !== false)
      .map((c) => c.id);
    return multiSelectDropdownTemplate({
      key: COLUMNS_KEY,
      label: 'Columns',
      options: col_defs.map((c) => ({ value: c.id, label: c.label })),
      selected: visible_ids,
      open: dropdowns.isOpen(COLUMNS_KEY),
      onToggle: dropdowns.toggle,
      onChange: (value) => toggleColumnVisibility(value),
      id_prefix: FILTER_ID_PREFIX,
      display_text: `Columns ${visible_ids.length}/${col_defs.length}`
    });
  }

  /**
   * Close the dropdown `key` when it is open, which renders once through the
   * controller; otherwise render directly.
   *
   * @param {string} key
   */
  function closeDropdownAndRender(key) {
    if (dropdowns.isOpen(key)) {
      dropdowns.close();
    } else {
      doRender();
    }
  }

  /**
   * Commit a Parent picker choice.
   *
   * @param {string|null} value
   */
  function commitParent(value) {
    parent_query = '';
    updateFilters({ parent: value });
    closeDropdownAndRender(PARENT_KEY);
  }

  /**
   * Add or remove one value of a string list filter.
   *
   * @param {'types'|'labels'} field
   * @param {string} value
   * @param {boolean} checked
   */
  function toggleListFilter(field, value, checked) {
    const current = getFilters()[field];
    updateFilters({
      [field]: checked
        ? [...current, value]
        : current.filter((v) => v !== value)
    });
    doRender();
  }

  /**
   * Add or remove one priority from the Priority filter.
   *
   * @param {string} value
   * @param {boolean} checked
   */
  function togglePriorityFilter(value, checked) {
    const p = Number(value);
    const current = getFilters().priorities;
    updateFilters({
      priorities: checked ? [...current, p] : current.filter((v) => v !== p)
    });
    doRender();
  }

  function onClearFilters() {
    parent_query = '';
    updateFilters(createEmptyBoardFilters());
    doRender();
  }

  /**
   * @param {Event} ev
   */
  function onParentTriggerClick(ev) {
    ev.stopPropagation();
    dropdowns.toggle(PARENT_KEY);
    if (dropdowns.isOpen(PARENT_KEY)) {
      const search = /** @type {HTMLInputElement|null} */ (
        mount_element.querySelector('.board-parent-picker__search')
      );
      search?.focus();
    }
  }

  /**
   * @param {Event} ev
   */
  function onParentQueryInput(ev) {
    parent_query = /** @type {HTMLInputElement} */ (ev.target).value;
    doRender();
  }

  /**
   * Option rows of the open Parent picker, in display order.
   *
   * @returns {HTMLElement[]}
   */
  function parentOptionRows() {
    return Array.from(
      mount_element.querySelectorAll(
        '.board-parent-picker__list [role="option"]'
      )
    );
  }

  /**
   * ArrowDown in the search box moves focus to the first row.
   *
   * @param {KeyboardEvent} ev
   */
  function onParentSearchKeydown(ev) {
    if (ev.key !== 'ArrowDown') {
      return;
    }
    const first = parentOptionRows()[0];
    if (first) {
      ev.preventDefault();
      first.focus();
    }
  }

  /**
   * Arrow, Home and End keys move focus between rows without committing;
   * Enter or Space commits the focused row.
   *
   * @param {KeyboardEvent} ev
   */
  function onParentListKeydown(ev) {
    const target = /** @type {HTMLElement|null} */ (ev.target);
    const row = target ? target.closest('[role="option"]') : null;
    if (!row) {
      return;
    }
    const rows = parentOptionRows();
    const idx = rows.indexOf(/** @type {HTMLElement} */ (row));
    if (idx === -1) {
      return;
    }
    const key = ev.key;
    if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      commitParent(row.getAttribute('data-value') || null);
      return;
    }
    /** @type {HTMLElement|null} */
    let next = null;
    if (key === 'ArrowDown') {
      next = rows[Math.min(idx + 1, rows.length - 1)];
    } else if (key === 'ArrowUp') {
      next =
        idx > 0
          ? rows[idx - 1]
          : /** @type {HTMLElement|null} */ (
              mount_element.querySelector('.board-parent-picker__search')
            );
    } else if (key === 'Home') {
      next = rows[0];
    } else if (key === 'End') {
      next = rows[rows.length - 1];
    } else {
      return;
    }
    ev.preventDefault();
    next?.focus();
  }

  /**
   * One Parent picker row. `value` null is the "Any parent" row.
   *
   * @param {string|null} value
   * @param {import('lit-html').TemplateResult} content
   * @param {{ depth: number, selected: boolean, muted: boolean }} state
   */
  function parentRowTemplate(value, content, state) {
    return html`<li
      role="option"
      class="board-parent-picker__option ${state.muted ? 'is-muted' : ''}"
      tabindex="-1"
      data-value=${value ?? ''}
      aria-selected=${state.selected ? 'true' : 'false'}
      style="--parent-depth: ${state.depth}"
      @click=${() => commitParent(value)}
    >
      ${content}
    </li>`;
  }

  /**
   * Parent picker: a searchable listbox of the board's ancestors in tree
   * order. A selection that is no longer an ancestor shows as not found.
   *
   * @param {string|null} selected
   */
  function parentPickerTemplate(selected) {
    const open = dropdowns.isOpen(PARENT_KEY);
    const all = last_filter_options.parents;
    const shown = filterParentOptions(all, parent_query);
    const stale = selected !== null && !all.some((o) => o.id === selected);
    const text =
      selected === null
        ? 'Parent: Any'
        : `Parent: ${selected}${stale ? ' (not found)' : ''}`;
    return html`
      <div
        class="filter-dropdown board-parent-picker ${open ? 'is-open' : ''}"
        data-filter=${PARENT_KEY}
      >
        <button
          type="button"
          class="filter-dropdown__trigger"
          aria-haspopup="listbox"
          aria-expanded=${open ? 'true' : 'false'}
          aria-controls=${PARENT_MENU_ID}
          @click=${onParentTriggerClick}
        >
          ${text}
          <span class="filter-dropdown__arrow" aria-hidden="true">▾</span>
        </button>
        <div
          class="filter-dropdown__menu board-parent-picker__menu"
          id=${PARENT_MENU_ID}
        >
          <input
            type="search"
            class="board-parent-picker__search"
            placeholder="Search parents"
            aria-label="Search parents"
            .value=${parent_query}
            @input=${onParentQueryInput}
            @keydown=${onParentSearchKeydown}
          />
          <ul
            class="board-parent-picker__list"
            role="listbox"
            aria-label="Parent"
            @keydown=${onParentListKeydown}
          >
            ${parentRowTemplate(null, html`Any parent`, {
              depth: 0,
              selected: selected === null,
              muted: false
            })}
            ${shown.map((o) =>
              parentRowTemplate(
                o.id,
                html`<span class="board-parent-picker__id mono">${o.id}</span>
                  <span class="board-parent-picker__title">${o.title}</span>`,
                {
                  depth: o.depth,
                  selected: selected === o.id,
                  muted: !o.known || o.status === 'closed'
                }
              )
            )}
          </ul>
          ${shown.length === 0
            ? html`<div class="board-parent-picker__empty">
                ${all.length === 0 ? 'No parents on the board' : 'No matches'}
              </div>`
            : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render the filter bar above the board grid: Parent, Types, Priority,
   * Labels (only when the board has labels), Assignee, Clear filters (only
   * while a filter is active) and Columns.
   *
   * @param {FilterOptions} filter_options
   */
  function filterBarTemplate(filter_options) {
    const current = getFilters();
    return html`
      <div class="board-filter-bar">
        <span class="board-filter-bar__label">Filter:</span>
        ${parentPickerTemplate(current.parent)}
        ${multiSelectDropdownTemplate({
          key: TYPES_KEY,
          label: 'Types',
          options: filter_options.types,
          selected: current.types,
          open: dropdowns.isOpen(TYPES_KEY),
          onToggle: dropdowns.toggle,
          onChange: (value, checked) =>
            toggleListFilter('types', value, checked),
          id_prefix: FILTER_ID_PREFIX
        })}
        ${multiSelectDropdownTemplate({
          key: PRIORITIES_KEY,
          label: 'Priority',
          options: PRIORITY_OPTIONS,
          selected: current.priorities.map(String),
          open: dropdowns.isOpen(PRIORITIES_KEY),
          onToggle: dropdowns.toggle,
          onChange: togglePriorityFilter,
          id_prefix: FILTER_ID_PREFIX
        })}
        ${filter_options.labels.length > 0
          ? multiSelectDropdownTemplate({
              key: LABELS_KEY,
              label: 'Labels',
              options: filter_options.labels,
              selected: current.labels,
              open: dropdowns.isOpen(LABELS_KEY),
              onToggle: dropdowns.toggle,
              onChange: (value, checked) =>
                toggleListFilter('labels', value, checked),
              id_prefix: FILTER_ID_PREFIX
            })
          : ''}
        <select
          aria-label="Filter by assignee"
          @change=${(/** @type {Event} */ ev) => {
            const v =
              /** @type {HTMLSelectElement} */ (ev.target).value || null;
            updateFilters({ assignee: v });
            doRender();
          }}
        >
          <option value="" .selected=${current.assignee === null}>
            All Assignees
          </option>
          ${filter_options.assignees.map(
            (a) =>
              html`<option value=${a} .selected=${current.assignee === a}>
                ${a}
              </option>`
          )}
        </select>
        ${hasActiveBoardFilters(current)
          ? html`<button
              type="button"
              class="board-filter-bar__clear"
              @click=${onClearFilters}
            >
              Clear filters
            </button>`
          : ''}
        ${columnVisibilityTemplate()}
      </div>
    `;
  }

  function template() {
    const visible_cols = getVisibleColumns();
    return html`
      ${filterBarTemplate(last_filter_options)}
      <div
        class="panel__body board-root"
        style="--board-columns: ${visible_cols.length}; --board-col-min-width: ${computeColMinWidth(
          mount_element.getBoundingClientRect?.()?.width || 1920,
          visible_cols.length,
          16,
          12
        )}px"
      >
        ${visible_cols.map((col) =>
          columnTemplate(col, column_view.get(col.id) || [])
        )}
      </div>
    `;
  }

  /**
   * @param {ColumnDef} col
   * @param {IssueLite[]} items
   */
  function columnTemplate(col, items) {
    const item_count = Array.isArray(items) ? items.length : 0;
    const count_label = item_count === 1 ? '1 issue' : `${item_count} issues`;
    const col_id = col.id + '-col';
    return html`
      <section class="board-column" id=${col_id}>
        <header
          class="board-column__header"
          id=${col_id + '-header'}
          role="heading"
          aria-level="2"
        >
          <div class="board-column__title">
            <span class="board-column__title-text">${col.label}</span>
            <span class="badge board-column__count" aria-label=${count_label}>
              ${item_count}
            </span>
          </div>
          ${col.is_closed
            ? html`<label class="board-closed-filter">
                <span class="visually-hidden">Filter closed issues</span>
                <select
                  id=${`closed-filter-${col.id}`}
                  aria-label="Filter closed issues"
                  @change=${onClosedFilterChange}
                >
                  <option
                    value="today"
                    ?selected=${closed_filter_mode === 'today'}
                  >
                    Today
                  </option>
                  <option value="3" ?selected=${closed_filter_mode === '3'}>
                    Last 3 days
                  </option>
                  <option value="7" ?selected=${closed_filter_mode === '7'}>
                    Last 7 days
                  </option>
                </select>
              </label>`
            : ''}
        </header>
        <div
          class="board-column__body"
          role="list"
          aria-labelledby=${col_id + '-header'}
        >
          ${items.map((it) => cardTemplate(it))}
        </div>
      </section>
    `;
  }

  /**
   * @param {IssueLite} it
   */
  function cardTemplate(it) {
    return html`
      <article
        class="board-card"
        data-issue-id=${it.id}
        role="listitem"
        tabindex="-1"
        draggable="true"
        @click=${(/** @type {MouseEvent} */ ev) => onCardClick(ev, it.id)}
        @dragstart=${(/** @type {DragEvent} */ ev) => onDragStart(ev, it.id)}
        @dragend=${onDragEnd}
      >
        <div class="board-card__title">${it.title || '(no title)'}</div>
        <div class="board-card__meta">
          ${createTypeBadge(it.issue_type)} ${createPriorityBadge(it.priority)}
          ${createIssueIdRenderer(it.id, { class_name: 'mono' })}
          ${opensInGraph(it)
            ? html`<button
                type="button"
                class="btn board-card__graph"
                aria-label=${`Open ${it.id} in graph`}
                title="Open in graph"
                @click=${(/** @type {MouseEvent} */ ev) =>
                  onGraphClick(ev, it.id)}
              >
                Graph
              </button>`
            : ''}
        </div>
      </article>
    `;
  }

  /**
   * Open the card's issue in the Graph tab without opening its details.
   *
   * @param {MouseEvent} ev
   * @param {string} id
   */
  function onGraphClick(ev, id) {
    ev.stopPropagation();
    if (typeof gotoGraph === 'function') {
      gotoGraph(id);
    }
  }

  /**
   * Find a rendered item by id in the filtered view.
   *
   * @param {string} id
   * @returns {IssueLite|null}
   */
  function viewItem(id) {
    for (const items of column_view.values()) {
      const found = items.find((it) => it.id === id);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** @type {string|null} */
  let dragging_id = null;

  /**
   * Handle card click, ignoring clicks during drag operations.
   *
   * @param {MouseEvent} ev
   * @param {string} id
   */
  function onCardClick(ev, id) {
    // Only navigate if this wasn't a drag operation
    if (!dragging_id) {
      gotoIssue(id);
    }
  }

  /**
   * Handle drag start: store issue id in dataTransfer and add dragging class.
   *
   * @param {DragEvent} ev
   * @param {string} id
   */
  function onDragStart(ev, id) {
    dragging_id = id;
    if (ev.dataTransfer) {
      ev.dataTransfer.setData('text/plain', id);
      ev.dataTransfer.effectAllowed = 'move';
    }
    const target = /** @type {HTMLElement} */ (ev.target);
    target.classList.add('board-card--dragging');
    log('dragstart %s', id);
  }

  /**
   * Handle drag end: remove dragging class.
   *
   * @param {DragEvent} ev
   */
  function onDragEnd(ev) {
    const target = /** @type {HTMLElement} */ (ev.target);
    target.classList.remove('board-card--dragging');
    // Clear any highlighted drop target
    clearDropTarget();
    // Clear dragging_id after a short delay to allow click event to check it
    setTimeout(() => {
      dragging_id = null;
    }, 0);
    log('dragend');
  }

  /**
   * Clear the currently highlighted drop target column.
   */
  function clearDropTarget() {
    /** @type {HTMLElement[]} */
    const all_cols = Array.from(
      mount_element.querySelectorAll('.board-column--drag-over')
    );
    for (const c of all_cols) {
      c.classList.remove('board-column--drag-over');
    }
  }

  /**
   * Update issue status via WebSocket transport.
   *
   * @param {string} issue_id
   * @param {'open'|'in_progress'|'closed'} new_status
   */
  async function updateIssueStatus(issue_id, new_status) {
    if (!transport) {
      log('no transport available, status update skipped');
      showToast('Cannot update status: not connected', 'error');
      return;
    }
    try {
      log('update-status %s → %s', issue_id, new_status);
      await transport('update-status', { id: issue_id, status: new_status });
      showToast('Status updated', 'success', 1500);
    } catch (err) {
      log('update-status failed: %o', err);
      showToast('Failed to update status', 'error');
    }
  }

  /** @type {ResizeObserver|null} */
  let resize_observer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let resize_debounce_timer = null;

  /**
   * Update card condensation classes based on column width.
   * Cards in narrow columns get condensed/minimal classes to fit.
   */
  function updateCardCondensation() {
    const columns = Array.from(mount_element.querySelectorAll('.board-column'));
    for (const col of columns) {
      const col_width = col.getBoundingClientRect().width;
      const cards = Array.from(col.querySelectorAll('.board-card'));
      for (const card of cards) {
        if (col_width < 180) {
          card.classList.add('board-card--minimal');
          card.classList.remove('board-card--condensed');
        } else if (col_width < 260) {
          card.classList.add('board-card--condensed');
          card.classList.remove('board-card--minimal');
        } else {
          card.classList.remove('board-card--condensed');
          card.classList.remove('board-card--minimal');
        }
      }
    }
  }

  /**
   * Set up a ResizeObserver on the mount element to recalculate column widths
   * and update card condensation classes on resize.
   */
  function setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined' || resize_observer) {
      return;
    }
    resize_observer = new ResizeObserver(() => {
      if (resize_debounce_timer) {
        clearTimeout(resize_debounce_timer);
      }
      resize_debounce_timer = setTimeout(() => {
        resize_debounce_timer = null;
        const board_root = /** @type {HTMLElement|null} */ (
          mount_element.querySelector('.board-root')
        );
        if (!board_root) {
          return;
        }
        const root_width = board_root.getBoundingClientRect().width;
        const col_count = getVisibleColumns().length;
        const min_width = computeColMinWidth(root_width, col_count, 16, 12);
        board_root.style.setProperty('--board-col-min-width', `${min_width}px`);
        updateCardCondensation();
      }, 100);
    });
    resize_observer.observe(mount_element);
  }

  function doRender() {
    render(template(), mount_element);
    postRenderEnhance();
    updateCardCondensation();
  }

  /**
   * Enhance rendered board with a11y and keyboard navigation.
   * - Roving tabindex per column (first card tabbable).
   * - ArrowUp/ArrowDown within column.
   * - ArrowLeft/ArrowRight to adjacent non-empty column (focus top card).
   * - Enter/Space to open details for focused card.
   * - g to open the focused card in the Graph tab when it qualifies.
   */
  function postRenderEnhance() {
    try {
      /** @type {HTMLElement[]} */
      const columns = Array.from(
        mount_element.querySelectorAll('.board-column')
      );
      for (const col of columns) {
        const body = /** @type {HTMLElement|null} */ (
          col.querySelector('.board-column__body')
        );
        if (!body) {
          continue;
        }
        /** @type {HTMLElement[]} */
        const cards = Array.from(body.querySelectorAll('.board-card'));
        // Assign aria-label using column header for screen readers
        const header = /** @type {HTMLElement|null} */ (
          col.querySelector('.board-column__header')
        );
        const col_name = header ? header.textContent?.trim() || '' : '';
        for (const card of cards) {
          const title_el = /** @type {HTMLElement|null} */ (
            card.querySelector('.board-card__title')
          );
          const t = title_el ? title_el.textContent?.trim() || '' : '';
          card.setAttribute(
            'aria-label',
            `Issue ${t || '(no title)'} - Column ${col_name}`
          );
          // Default roving setup
          card.tabIndex = -1;
        }
        if (cards.length > 0) {
          cards[0].tabIndex = 0;
        }
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * Keyboard handler for board navigation (delegated from mount_element).
   *
   * @param {KeyboardEvent} ev
   */
  function handleKeydown(ev) {
    const target = ev.target;
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }
    // Do not intercept keys inside editable controls
    const tag = String(target.tagName || '').toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target.isContentEditable === true
    ) {
      return;
    }
    // Buttons inside a card handle their own Enter and Space
    if (target.closest('button')) {
      return;
    }
    const card = target.closest('.board-card');
    if (!card) {
      return;
    }
    const key = String(ev.key || '');
    if (key === GRAPH_KEY && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const id = card.getAttribute('data-issue-id');
      const item = id ? viewItem(id) : null;
      if (id && item && opensInGraph(item) && typeof gotoGraph === 'function') {
        ev.preventDefault();
        gotoGraph(id);
      }
      return;
    }
    if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      const id = card.getAttribute('data-issue-id');
      if (id) {
        gotoIssue(id);
      }
      return;
    }
    if (
      key !== 'ArrowUp' &&
      key !== 'ArrowDown' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight'
    ) {
      return;
    }
    ev.preventDefault();
    // Column context
    const col = /** @type {HTMLElement|null} */ (card.closest('.board-column'));
    if (!col) {
      return;
    }
    const body = col.querySelector('.board-column__body');
    if (!body) {
      return;
    }
    /** @type {HTMLElement[]} */
    const cards = Array.from(body.querySelectorAll('.board-card'));
    const idx = cards.indexOf(/** @type {HTMLElement} */ (card));
    if (idx === -1) {
      return;
    }
    if (key === 'ArrowDown' && idx < cards.length - 1) {
      moveFocus(cards[idx], cards[idx + 1]);
      return;
    }
    if (key === 'ArrowUp' && idx > 0) {
      moveFocus(cards[idx], cards[idx - 1]);
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Find adjacent column with at least one card
      /** @type {HTMLElement[]} */
      const cols = Array.from(mount_element.querySelectorAll('.board-column'));
      const col_idx = cols.indexOf(col);
      if (col_idx === -1) {
        return;
      }
      const dir = key === 'ArrowRight' ? 1 : -1;
      let next_idx = col_idx + dir;
      /** @type {HTMLElement|null} */
      let target_col = null;
      while (next_idx >= 0 && next_idx < cols.length) {
        const candidate = cols[next_idx];
        const c_body = /** @type {HTMLElement|null} */ (
          candidate.querySelector('.board-column__body')
        );
        const c_cards = c_body
          ? Array.from(c_body.querySelectorAll('.board-card'))
          : [];
        if (c_cards.length > 0) {
          target_col = candidate;
          break;
        }
        next_idx += dir;
      }
      if (target_col) {
        const first = /** @type {HTMLElement|null} */ (
          target_col.querySelector('.board-column__body .board-card')
        );
        if (first) {
          moveFocus(/** @type {HTMLElement} */ (card), first);
        }
      }
      return;
    }
  }

  // Delegate keyboard handling from mount_element
  mount_element.addEventListener('keydown', handleKeydown);

  // Track the currently highlighted column to avoid flicker
  /** @type {HTMLElement|null} */
  let current_drop_target = null;

  /**
   * Dragover handler: highlight target column during drag.
   *
   * @param {DragEvent} ev
   */
  function handleDragover(ev) {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }
    // Find the column being dragged over
    const target = /** @type {HTMLElement} */ (ev.target);
    const col = /** @type {HTMLElement|null} */ (
      target.closest('.board-column')
    );

    // Only update if we've entered a different column
    if (col && col !== current_drop_target) {
      // Remove highlight from previous column
      if (current_drop_target) {
        current_drop_target.classList.remove('board-column--drag-over');
      }
      // Highlight the new column
      col.classList.add('board-column--drag-over');
      current_drop_target = col;
    }
  }

  /**
   * Dragleave handler: clear highlight when leaving mount element.
   *
   * @param {DragEvent} ev
   */
  function handleDragleave(ev) {
    const related = /** @type {HTMLElement|null} */ (ev.relatedTarget);
    // Only clear if we're leaving the mount element entirely
    if (!related || !mount_element.contains(related)) {
      if (current_drop_target) {
        current_drop_target.classList.remove('board-column--drag-over');
        current_drop_target = null;
      }
    }
  }

  /**
   * Drop handler: update issue status based on target column.
   *
   * @param {DragEvent} ev
   */
  function handleDrop(ev) {
    ev.preventDefault();
    // Clear the drop target highlight
    if (current_drop_target) {
      current_drop_target.classList.remove('board-column--drag-over');
      current_drop_target = null;
    }

    const target = /** @type {HTMLElement} */ (ev.target);
    const col = target.closest('.board-column');
    if (!col) {
      return;
    }

    const col_el_id = col.id;
    const col_def = col_defs.find((c) => c.id + '-col' === col_el_id);
    if (!col_def || !col_def.drop_status) {
      log('drop on unknown column: %s', col_el_id);
      return;
    }
    const new_status = /** @type {'open'|'in_progress'|'closed'} */ (
      col_def.drop_status
    );

    const issue_id = ev.dataTransfer?.getData('text/plain');
    if (!issue_id) {
      log('drop without issue id');
      return;
    }

    log('drop %s on %s → %s', issue_id, col_el_id, new_status);
    void updateIssueStatus(issue_id, new_status);
  }

  // Delegate drag and drop handling for columns
  mount_element.addEventListener('dragover', handleDragover);
  mount_element.addEventListener('dragleave', handleDragleave);
  mount_element.addEventListener('drop', handleDrop);

  /**
   * @param {HTMLElement} from
   * @param {HTMLElement} to
   */
  function moveFocus(from, to) {
    try {
      from.tabIndex = -1;
      to.tabIndex = 0;
      to.focus();
    } catch {
      // ignore focus errors
    }
  }

  // Sort helpers centralized in app/data/sort.js

  /**
   * Recompute filtered list for all closed-type columns from their raw data.
   */
  function applyClosedFilter() {
    log('applyClosedFilter %s', closed_filter_mode);
    const now = new Date();
    let since_ts = 0;
    if (closed_filter_mode === 'today') {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      );
      since_ts = start.getTime();
    } else if (closed_filter_mode === '3') {
      since_ts = now.getTime() - 3 * 24 * 60 * 60 * 1000;
    } else if (closed_filter_mode === '7') {
      since_ts = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    }
    for (const col of col_defs) {
      if (!col.is_closed) {
        continue;
      }
      const raw = column_raw.get(col.id) || [];
      /** @type {IssueLite[]} */
      let items = [...raw];
      items = items.filter((it) => {
        const s = Number.isFinite(it.closed_at)
          ? /** @type {number} */ (it.closed_at)
          : NaN;
        if (!Number.isFinite(s)) {
          return false;
        }
        return s >= since_ts;
      });
      items.sort(cmpClosedDesc);
      column_data.set(col.id, items);
    }
  }

  /**
   * @param {Event} ev
   */
  function onClosedFilterChange(ev) {
    try {
      const el = /** @type {HTMLSelectElement} */ (ev.target);
      const v = String(el.value || 'today');
      closed_filter_mode = v === '3' || v === '7' ? v : 'today';
      log('closed filter %s', closed_filter_mode);
      if (store) {
        try {
          store.setState({ board: { closed_filter: closed_filter_mode } });
        } catch {
          // ignore store errors
        }
      }
      // Options come from the unfiltered board, so only the view changes
      applyClosedFilter();
      applyBoardFilters();
      doRender();
    } catch {
      // ignore
    }
  }

  /**
   * Derive selectBoardColumn mode from a column's drop_status.
   * Closed columns use cmpClosedDesc sort; all others use cmpPriorityThenCreated.
   *
   * @param {ColumnDef} col
   * @returns {'ready'|'closed'}
   */
  function columnToMode(col) {
    return col.drop_status === 'closed' ? 'closed' : 'ready';
  }

  /**
   * True when the item is the parent or one of its descendants. Walks the
   * item's ancestors, so a parent the index has no row for (such as a
   * closed epic before the board index arrives) still matches its children.
   *
   * @param {string} id
   * @param {string} parent
   */
  function isInParentScope(id, parent) {
    return id === parent || ancestorIds(dep_index, id).includes(parent);
  }

  /**
   * Fill column_view from column_data through the board filters: AND across
   * filters, OR within one. Parent matches the parent itself and every
   * descendant in the dependency index.
   */
  function applyBoardFilters() {
    const filters = getFilters();
    if (!hasActiveBoardFilters(filters)) {
      for (const [col_id, items] of column_data) {
        column_view.set(col_id, items);
      }
      return;
    }
    const parent = filters.parent;
    const types = new Set(filters.types);
    const priorities = new Set(filters.priorities);
    const labels = new Set(filters.labels);
    for (const [col_id, items] of column_data) {
      const filtered = items.filter((it) => {
        if (parent !== null && !isInParentScope(it.id, parent)) {
          return false;
        }
        if (filters.assignee !== null && it.assignee !== filters.assignee) {
          return false;
        }
        if (types.size > 0 && !types.has(String(it.issue_type || ''))) {
          return false;
        }
        if (priorities.size > 0 && !priorities.has(priorityOf(it))) {
          return false;
        }
        if (labels.size > 0 && !labelsOf(it).some((l) => labels.has(l))) {
          return false;
        }
        return true;
      });
      column_view.set(col_id, filtered);
    }
  }

  /**
   * Recompute everything derived from the column data: the closed date
   * filter, the dependency index, the filter options (before any board
   * filter, so they show all values) and the filtered view.
   */
  function recompute() {
    applyClosedFilter();
    rebuildIndex();
    last_filter_options = getFilterOptions();
    applyBoardFilters();
  }

  /**
   * Compose lists from subscriptions + issues store and render.
   */
  function refreshFromStores() {
    try {
      if (selectors) {
        // Collect in-progress IDs for ready-excludes-in-progress logic
        /** @type {Set<string>} */
        const in_prog_ids = new Set();
        for (const col of col_defs) {
          if (col.subscription === 'in-progress-issues') {
            const items = selectors.selectBoardColumn(
              'tab:board:' + col.id,
              'in_progress'
            );
            for (const it of items) {
              in_prog_ids.add(it.id);
            }
            column_data.set(col.id, items);
          }
        }

        // Populate remaining columns
        for (const col of col_defs) {
          if (col.subscription === 'in-progress-issues') {
            continue; // already handled above
          }
          const mode = columnToMode(col);
          const items = selectors.selectBoardColumn(
            'tab:board:' + col.id,
            mode
          );

          if (col.subscription === 'ready-issues') {
            // Ready excludes items that are in progress
            column_data.set(
              col.id,
              items.filter((i) => !in_prog_ids.has(i.id))
            );
          } else if (col.is_closed) {
            column_raw.set(col.id, items);
          } else {
            column_data.set(col.id, items);
          }
        }
      }
      recompute();
      doRender();
    } catch (err) {
      log('refreshFromStores error: %o', err);
      for (const col of col_defs) {
        column_data.set(col.id, []);
        column_view.set(col.id, []);
      }
      doRender();
    }
  }

  // Live updates: recompose on issue store envelopes
  /** @type {(() => void)|null} */
  let unsub_selectors = null;
  if (selectors) {
    unsub_selectors = selectors.subscribe(() => {
      try {
        refreshFromStores();
      } catch {
        // ignore
      }
    });
  }

  return {
    async load() {
      // Compose lists from subscriptions + issues store
      log('load');
      refreshFromStores();
      // If nothing is present yet (e.g., immediately after switching back
      // to the Board and before list-delta arrives), fetch via data layer as
      // a fallback so the board is not empty on initial display.
      try {
        const has_subs = Boolean(subscriptions && subscriptions.selectors);
        /**
         * @param {string} id
         */
        const cnt = (id) => {
          if (!has_subs || !subscriptions) {
            return 0;
          }
          const sel = subscriptions.selectors;
          if (typeof sel.count === 'function') {
            return Number(sel.count(id) || 0);
          }
          try {
            const arr = sel.getIds(id);
            return Array.isArray(arr) ? arr.length : 0;
          } catch {
            return 0;
          }
        };
        let total_items = 0;
        for (const col of col_defs) {
          total_items += cnt('tab:board:' + col.id);
        }
        const data = /** @type {any} */ (_data);
        /** @type {Record<string, string>} */
        const subscription_methods = {
          'ready-issues': 'getReady',
          'blocked-issues': 'getBlocked',
          'in-progress-issues': 'getInProgress',
          'closed-issues': 'getClosed'
        };
        const can_fetch =
          data &&
          col_defs.every((col) => {
            const method = subscription_methods[col.subscription];
            return !method || typeof data[method] === 'function';
          });
        if (total_items === 0 && can_fetch) {
          log('fallback fetch');
          /** @type {Map<string, IssueLite[]>} */
          const fallback_map = new Map();
          /** @type {Set<string>} */
          const fetched_subs = new Set();
          const fetch_promises = [];
          for (const col of col_defs) {
            if (fetched_subs.has(col.subscription)) {
              continue;
            }
            const method = subscription_methods[col.subscription];
            if (method && typeof data[method] === 'function') {
              fetched_subs.add(col.subscription);
              fetch_promises.push(
                data[method]()
                  .catch(() => [])
                  .then((/** @type {IssueLite[]} */ raw) => {
                    fallback_map.set(
                      col.subscription,
                      Array.isArray(raw) ? raw.slice() : []
                    );
                  })
              );
            }
          }
          await Promise.all(fetch_promises);

          // Collect in-progress IDs for ready filtering
          /** @type {Set<string>} */
          const in_progress_ids = new Set(
            (fallback_map.get('in-progress-issues') || []).map((i) => i.id)
          );

          for (const col of col_defs) {
            let items = fallback_map.get(col.subscription) || [];
            if (col.subscription === 'ready-issues') {
              items = items.filter((i) => !in_progress_ids.has(i.id));
            }
            // Same split as refreshFromStores: only is_closed columns
            // go through the closed date filter
            if (col.is_closed) {
              column_raw.set(col.id, items);
            } else {
              items.sort(cmpPriorityThenCreated);
              column_data.set(col.id, items);
            }
          }
          recompute();
          doRender();
        }
      } catch {
        // ignore fallback errors
      }
      setupResizeObserver();
    },
    clear() {
      // Unsubscribe from selectors to prevent leaked subscriptions
      if (unsub_selectors) {
        unsub_selectors();
        unsub_selectors = null;
      }
      // Remove delegated event listeners to prevent accumulation on hot-reload
      mount_element.removeEventListener('keydown', handleKeydown);
      mount_element.removeEventListener('dragover', handleDragover);
      mount_element.removeEventListener('dragleave', handleDragleave);
      mount_element.removeEventListener('drop', handleDrop);
      dropdowns.dispose();
      // Disconnect ResizeObserver
      if (resize_observer) {
        resize_observer.disconnect();
        resize_observer = null;
      }
      if (resize_debounce_timer) {
        clearTimeout(resize_debounce_timer);
        resize_debounce_timer = null;
      }
      // Reset drag state
      dragging_id = null;
      current_drop_target = null;
      render(nothing, mount_element);
      for (const col of col_defs) {
        column_data.set(col.id, []);
        column_view.set(col.id, []);
        if (col.is_closed) {
          column_raw.set(col.id, []);
        }
      }
      dep_index = buildDepIndex([]);
      dep_index_inputs = null;
    }
  };
}
