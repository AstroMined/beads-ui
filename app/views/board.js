import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import { cmpClosedDesc, cmpPriorityThenCreated } from '../data/sort.js';
import { createIssueIdRenderer } from '../utils/issue-id-renderer.js';
import { debug } from '../utils/logging.js';
import { createPriorityBadge } from '../utils/priority-badge.js';
import { showToast } from '../utils/toast.js';
import { createTypeBadge } from '../utils/type-badge.js';

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
 *   assignee?: string
 * }} IssueLite
 */

/**
 * @typedef {Object} ColumnDef
 * @property {string} id - Unique column identifier.
 * @property {string} label - Display label for the column header.
 * @property {string} subscription - Subscription type for data.
 * @property {Record<string, unknown>} [params] - Optional subscription parameters.
 * @property {string} drop_status - Status to set when a card is dropped.
 */

/**
 * Create the Board view with dynamic columns from settings.
 * Push-only: derives items from per-subscription stores.
 *
 * Sorting rules:
 * - Closed columns: closed_at desc.
 * - All others: priority asc, then created_at asc.
 *
 * @param {HTMLElement} mount_element
 * @param {unknown} _data - Unused (legacy param retained for call-compat)
 * @param {(id: string) => void} gotoIssue - Navigate to issue detail.
 * @param {{ getState: () => any, setState: (patch: any) => void, subscribe?: (fn: (s:any)=>void)=>()=>void }} [store]
 * @param {{ selectors: { getIds: (client_id: string) => string[], count?: (client_id: string) => number } }} [subscriptions]
 * @param {{ snapshotFor?: (client_id: string) => any[], subscribe?: (fn: () => void) => () => void }} [issueStores]
 * @param {(type: string, payload: unknown) => Promise<unknown>} [transport] - Transport function for sending updates
 * @param {ColumnDef[]} [columns] - Column definitions from settings
 * @returns {{ load: () => Promise<void>, clear: () => void }}
 */
export function createBoardView(
  mount_element,
  _data,
  gotoIssue,
  store,
  subscriptions = undefined,
  issueStores = undefined,
  transport = undefined,
  columns = undefined
) {
  const log = debug('views:board');

  /** @type {ColumnDef[]} */
  const col_defs =
    Array.isArray(columns) && columns.length > 0
      ? columns
      : [
          {
            id: 'blocked',
            label: 'Blocked',
            subscription: 'blocked-issues',
            drop_status: 'open'
          },
          {
            id: 'ready',
            label: 'Ready',
            subscription: 'ready-issues',
            drop_status: 'open'
          },
          {
            id: 'in-progress',
            label: 'In Progress',
            subscription: 'in-progress-issues',
            drop_status: 'in_progress'
          },
          {
            id: 'closed',
            label: 'Closed',
            subscription: 'closed-issues',
            drop_status: 'closed'
          }
        ];

  /** @type {Map<string, IssueLite[]>} */
  const column_data = new Map();
  /** @type {Map<string, IssueLite[]>} */
  const column_raw = new Map();
  for (const col of col_defs) {
    column_data.set(col.id, []);
    if (col.subscription === 'closed-issues') {
      column_raw.set(col.id, []);
    }
  }
  // Centralized selection helpers
  const selectors = issueStores ? createListSelectors(issueStores) : null;

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

  /** @type {{ parents: string[], assignees: string[], types: string[] }} */
  let filter_options = { parents: [], assignees: [], types: [] };

  /**
   * Scan all column_data Map entries for unique filter values.
   * Must be called BEFORE board filters are applied so dropdowns
   * show all available values, not just the filtered subset.
   *
   * @returns {{ parents: string[], assignees: string[], types: string[] }}
   */
  function getFilterOptions() {
    /** @type {Set<string>} */
    const parents = new Set();
    /** @type {Set<string>} */
    const assignees = new Set();
    /** @type {Set<string>} */
    const types = new Set();
    for (const [, items] of column_data) {
      for (const it of items) {
        if (it.parent && typeof it.parent === 'string') {
          parents.add(it.parent);
        }
        if (it.assignee && typeof it.assignee === 'string') {
          assignees.add(it.assignee);
        }
        if (it.issue_type && typeof it.issue_type === 'string') {
          types.add(it.issue_type);
        }
      }
    }
    // Also scan column_raw for closed columns (they may have items
    // not yet in column_data due to the closed date filter)
    for (const [, items] of column_raw) {
      for (const it of items) {
        if (it.parent && typeof it.parent === 'string') {
          parents.add(it.parent);
        }
        if (it.assignee && typeof it.assignee === 'string') {
          assignees.add(it.assignee);
        }
        if (it.issue_type && typeof it.issue_type === 'string') {
          types.add(it.issue_type);
        }
      }
    }
    return {
      parents: Array.from(parents).sort((a, b) => a.localeCompare(b)),
      assignees: Array.from(assignees).sort((a, b) => a.localeCompare(b)),
      types: Array.from(types).sort((a, b) => a.localeCompare(b))
    };
  }

  /**
   * Render the filter bar with three select dropdowns above the board grid.
   */
  function filterBarTemplate() {
    const board_state = store ? store.getState().board : null;
    const current = board_state?.board_filters || {
      parent: null,
      assignee: null,
      type: null
    };
    return html`
      <div class="board-filter-bar">
        <span class="board-filter-bar__label">Filter:</span>
        <select
          aria-label="Filter by parent"
          @change=${(/** @type {Event} */ ev) => {
            const v =
              /** @type {HTMLSelectElement} */ (ev.target).value || null;
            onBoardFilterChange('parent', v);
          }}
        >
          <option value="">All Parents</option>
          ${filter_options.parents.map(
            (p) =>
              html`<option value=${p} ?selected=${current.parent === p}>
                ${p}
              </option>`
          )}
        </select>
        <select
          aria-label="Filter by assignee"
          @change=${(/** @type {Event} */ ev) => {
            const v =
              /** @type {HTMLSelectElement} */ (ev.target).value || null;
            onBoardFilterChange('assignee', v);
          }}
        >
          <option value="">All Assignees</option>
          ${filter_options.assignees.map(
            (a) =>
              html`<option value=${a} ?selected=${current.assignee === a}>
                ${a}
              </option>`
          )}
        </select>
        <select
          aria-label="Filter by type"
          @change=${(/** @type {Event} */ ev) => {
            const v =
              /** @type {HTMLSelectElement} */ (ev.target).value || null;
            onBoardFilterChange('type', v);
          }}
        >
          <option value="">All Types</option>
          ${filter_options.types.map(
            (t) =>
              html`<option value=${t} ?selected=${current.type === t}>
                ${t}
              </option>`
          )}
        </select>
      </div>
    `;
  }

  /**
   * Handle board filter change from any of the three filter dropdowns.
   *
   * @param {'parent'|'assignee'|'type'} field
   * @param {string|null} value
   */
  function onBoardFilterChange(field, value) {
    if (store) {
      try {
        store.setState({
          board: { board_filters: { [field]: value } }
        });
      } catch {
        // ignore store errors
      }
    }
    refreshFromStores();
  }

  function template() {
    return html`
      ${filterBarTemplate()}
      <div
        class="panel__body board-root"
        style="--board-columns: ${col_defs.length}"
      >
        ${col_defs.map((col) =>
          columnTemplate(col, column_data.get(col.id) || [])
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
          ${col.subscription === 'closed-issues'
            ? html`<label class="board-closed-filter">
                <span class="visually-hidden">Filter closed issues</span>
                <select
                  id="closed-filter"
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
        </div>
      </article>
    `;
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

  function doRender() {
    render(template(), mount_element);
    postRenderEnhance();
  }

  /**
   * Enhance rendered board with a11y and keyboard navigation.
   * - Roving tabindex per column (first card tabbable).
   * - ArrowUp/ArrowDown within column.
   * - ArrowLeft/ArrowRight to adjacent non-empty column (focus top card).
   * - Enter/Space to open details for focused card.
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
            `Issue ${t || '(no title)'} — Column ${col_name}`
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

  // Delegate keyboard handling from mount_element
  mount_element.addEventListener('keydown', (ev) => {
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
    const card = target.closest('.board-card');
    if (!card) {
      return;
    }
    const key = String(ev.key || '');
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
  });

  // Track the currently highlighted column to avoid flicker
  /** @type {HTMLElement|null} */
  let current_drop_target = null;

  // Delegate drag and drop handling for columns
  mount_element.addEventListener('dragover', (ev) => {
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
  });

  mount_element.addEventListener('dragleave', (ev) => {
    const related = /** @type {HTMLElement|null} */ (ev.relatedTarget);
    // Only clear if we're leaving the mount element entirely
    if (!related || !mount_element.contains(related)) {
      if (current_drop_target) {
        current_drop_target.classList.remove('board-column--drag-over');
        current_drop_target = null;
      }
    }
  });

  mount_element.addEventListener('drop', (ev) => {
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
  });

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
      if (col.subscription !== 'closed-issues') {
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
      applyClosedFilter();
      filter_options = getFilterOptions();
      applyBoardFilters();
      doRender();
    } catch {
      // ignore
    }
  }

  /**
   * Map subscription type to selectBoardColumn mode.
   *
   * @param {string} subscription
   * @returns {'ready'|'blocked'|'in_progress'|'closed'}
   */
  function subscriptionToMode(subscription) {
    switch (subscription) {
      case 'ready-issues':
        return 'ready';
      case 'blocked-issues':
        return 'blocked';
      case 'in-progress-issues':
        return 'in_progress';
      case 'closed-issues':
        return 'closed';
      default:
        return 'ready';
    }
  }

  /**
   * Apply board filters (parent, assignee, type) with AND logic
   * to all entries in column_data Map.
   */
  function applyBoardFilters() {
    const board_state = store ? store.getState().board : null;
    const filters = board_state?.board_filters || {
      parent: null,
      assignee: null,
      type: null
    };
    const has_filter =
      (filters.parent !== null && filters.parent !== undefined) ||
      (filters.assignee !== null && filters.assignee !== undefined) ||
      (filters.type !== null && filters.type !== undefined);
    if (!has_filter) {
      return;
    }
    for (const [col_id, items] of column_data) {
      const filtered = items.filter((it) => {
        if (filters.parent !== null && it.parent !== filters.parent) {
          return false;
        }
        if (filters.assignee !== null && it.assignee !== filters.assignee) {
          return false;
        }
        if (filters.type !== null && it.issue_type !== filters.type) {
          return false;
        }
        return true;
      });
      column_data.set(col_id, filtered);
    }
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
          const mode = subscriptionToMode(col.subscription);
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
          } else if (col.subscription === 'closed-issues') {
            column_raw.set(col.id, items);
          } else {
            column_data.set(col.id, items);
          }
        }
      }
      applyClosedFilter();
      // Compute filter options BEFORE applying board filters
      // so dropdowns show all available values
      filter_options = getFilterOptions();
      applyBoardFilters();
      doRender();
    } catch {
      for (const col of col_defs) {
        column_data.set(col.id, []);
      }
      doRender();
    }
  }

  // Live updates: recompose on issue store envelopes
  if (selectors) {
    selectors.subscribe(() => {
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
        const can_fetch =
          data &&
          typeof data.getReady === 'function' &&
          typeof data.getBlocked === 'function' &&
          typeof data.getInProgress === 'function' &&
          typeof data.getClosed === 'function';
        if (total_items === 0 && can_fetch) {
          log('fallback fetch');
          /** @type {[IssueLite[], IssueLite[], IssueLite[], IssueLite[]]} */
          const [ready_raw, blocked_raw, in_prog_raw, closed_raw] =
            await Promise.all([
              data.getReady().catch(() => []),
              data.getBlocked().catch(() => []),
              data.getInProgress().catch(() => []),
              data.getClosed().catch(() => [])
            ]);

          /** @type {Map<string, IssueLite[]>} */
          const fallback_map = new Map([
            [
              'ready-issues',
              Array.isArray(ready_raw) ? ready_raw.map((it) => it) : []
            ],
            [
              'blocked-issues',
              Array.isArray(blocked_raw) ? blocked_raw.map((it) => it) : []
            ],
            [
              'in-progress-issues',
              Array.isArray(in_prog_raw) ? in_prog_raw.map((it) => it) : []
            ],
            [
              'closed-issues',
              Array.isArray(closed_raw) ? closed_raw.map((it) => it) : []
            ]
          ]);

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
            if (col.subscription === 'closed-issues') {
              column_raw.set(col.id, items);
            } else {
              items.sort(cmpPriorityThenCreated);
              column_data.set(col.id, items);
            }
          }
          applyClosedFilter();
          doRender();
        }
      } catch {
        // ignore fallback errors
      }
    },
    clear() {
      mount_element.replaceChildren();
      for (const col of col_defs) {
        column_data.set(col.id, []);
        if (col.subscription === 'closed-issues') {
          column_raw.set(col.id, []);
        }
      }
    }
  };
}
