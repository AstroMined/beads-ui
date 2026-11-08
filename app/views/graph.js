/**
 * @import { DepIndex, DepIssue, DepLink, GraphSlice, NodeState, UnlockGroup, Unlocks, WorkItem, WorkOrder } from '../data/dep-graph.js'
 * @import { GraphLayout, LayoutEdge, LayoutNode } from '../data/dep-graph-layout.js'
 * @import { AppState } from '../state.js'
 */
import { html, nothing, render, svg } from 'lit-html';
import { layoutGraph } from '../data/dep-graph-layout.js';
import {
  MAX_GRAPH_NODES,
  ancestorIds,
  buildDepIndex,
  collectGraphSlice,
  computeSuggestions,
  computeUnlocks,
  computeWorkOrder,
  nodeState,
  searchFocusCandidates
} from '../data/dep-graph.js';
import { GRAPH_CLIENT_ID } from '../data/graph-subscription.js';
import { createPriorityBadge } from '../utils/priority-badge.js';
import { statusLabel } from '../utils/status.js';
import { createTypeBadge } from '../utils/type-badge.js';

/**
 * Depth choices for the graph pane. `depth` is the slice's `max_depth`.
 *
 * @type {ReadonlyArray<{ value: string, label: string, depth: number }>}
 */
const DEPTH_CHOICES = Object.freeze([
  { value: '1', label: '1', depth: 1 },
  { value: '2', label: '2', depth: 2 },
  { value: 'all', label: 'All', depth: Infinity }
]);

/** Depth choice selected when the view is created. */
const DEFAULT_DEPTH_VALUE = '2';

/** Names listed before "and N more" in still-waiting and overflow notes. */
const NAMES_SHOWN = 2;

/** Width of a "+N" fold chip in px; it sits inside the node's right edge. */
const FOLD_CHIP_WIDTH = 32;

/** How far a fold chip hangs below its node's bottom edge in px. */
const FOLD_CHIP_DROP = 10;

/** Size of the line samples drawn in the legend, in px. */
const LEGEND_SAMPLE_WIDTH = 32;
const LEGEND_SAMPLE_HEIGHT = 10;

/** Element ids, unique because the app mounts one graph view. */
const PICKER_INPUT_ID = 'graph-picker-input';
const PICKER_LIST_ID = 'graph-picker-list';
const PICKER_OPTION_PREFIX = 'graph-picker-option-';
const ARROW_MARKER_ID = 'graph-arrow';
const CYCLE_MARKER_ID = 'graph-arrow-cycle';
const FOLD_LIST_PREFIX = 'graph-fold-';

/**
 * Short visible state text, so a node's state never relies on colour.
 *
 * @type {Readonly<Record<NodeState, string>>}
 */
const STATE_SHORT = Object.freeze({
  closed: 'Closed',
  external: 'External',
  cycle: 'Cycle',
  blocked: 'Blocked',
  ready: 'Ready',
  held: 'Held'
});

/**
 * Spoken state text. `held` is spelled out per bead with its status.
 *
 * @type {Readonly<Record<NodeState, string>>}
 */
const STATE_SPOKEN = Object.freeze({
  closed: 'closed',
  external: 'external, status unknown',
  cycle: 'stuck in a dependency cycle',
  blocked: 'blocked',
  ready: 'ready to start',
  held: 'unblocked'
});

/** Column regions of the graph pane, left to right. */
const REGIONS = Object.freeze([
  {
    label: 'Prerequisites',
    role: 'prerequisite',
    /** @param {number} c */
    match: (c) => c < 0
  },
  {
    label: 'Focus',
    role: 'current focus',
    /** @param {number} c */
    match: (c) => c === 0
  },
  {
    label: 'Unlocks',
    role: 'unlocked by the focus',
    /** @param {number} c */
    match: (c) => c > 0
  }
]);

/** Legend rows: the line pattern is named in text, not only drawn. */
const LEGEND = Object.freeze([
  { kind: 'blocks', cycle: false, label: 'Blocks (solid line)' },
  {
    kind: 'inherited',
    cycle: false,
    label: 'Inherited from a parent (dashed line)'
  },
  { kind: 'child', cycle: false, label: 'Part of a container (dotted line)' },
  { kind: 'related', cycle: false, label: 'Related, no order (thin line)' },
  { kind: 'blocks', cycle: true, label: 'Cycle (red, barred arrow)' }
]);

/**
 * Issue stores the view reads. `getStore` exposes the graph store's
 * snapshot array, which the store replaces each time it applies a message,
 * so its identity serves as the store revision.
 *
 * @typedef {{
 *   snapshotFor: (client_id: string) => DepIssue[],
 *   subscribe: (fn: () => void) => () => void,
 *   getStore: (client_id: string) => { snapshot: () => readonly unknown[] } | null
 * }} GraphIssueStores
 */

/**
 * @typedef {Object} GraphViewOptions
 * @property {HTMLElement} mount_element
 * @property {{ getState: () => AppState, subscribe: (fn: (s: AppState) => void) => () => void }} store
 * @property {GraphIssueStores} issue_stores
 * @property {(id: string | null) => void} gotoGraph - Refocus the graph, or clear the focus with null.
 * @property {(id: string) => void} gotoIssue - Open the detail dialog.
 */

/**
 * @typedef {{
 *   load: () => void,
 *   setLoaded: (loaded: boolean) => void,
 *   setError: (message: string | null, retry?: () => void) => void,
 *   destroy: () => void
 * }} GraphView
 */

/**
 * Everything derived for one focus, memoized together.
 *
 * @typedef {{
 *   index: DepIndex,
 *   focus: string,
 *   depth: number,
 *   include_closed: boolean,
 *   expand_rev: number,
 *   work: WorkOrder,
 *   unlocks: Unlocks,
 *   slice: GraphSlice,
 *   layout: GraphLayout
 * }} FocusModel
 */

/**
 * List names as "A", "A and B", or "A, B and N more".
 *
 * @param {string[]} names
 * @param {number} shown
 */
function listNames(names, shown) {
  if (names.length > shown) {
    return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
  }
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Lower-case status text, e.g. "in progress" or "in review".
 *
 * @param {string} status
 */
function statusText(status) {
  return statusLabel(status).toLowerCase().replaceAll('_', ' ');
}

/**
 * Reason chip text for a plan item. `link.id` is the dependent in the plan.
 *
 * @param {DepLink} link
 */
function planReasonText(link) {
  if (link.reason === 'blocks') {
    return `blocks ${link.id}`;
  }
  if (link.reason === 'inherited') {
    return `blocks parent ${link.via} of ${link.id}`;
  }
  return `part of ${link.id}`;
}

/**
 * Reason chip text for an unlocked bead. `link.id` is the prerequisite that
 * closes before it.
 *
 * @param {DepLink} link
 */
function unlockReasonText(link) {
  if (link.reason === 'blocks') {
    return `after ${link.id}`;
  }
  if (link.reason === 'inherited') {
    return `after ${link.id}, which blocks parent ${link.via}`;
  }
  return `after child ${link.id}`;
}

/**
 * Create the Graph tab: a toolbar with a bead picker, then a Plan pane (the
 * ordered work before the focus and what it unlocks) beside a drawn graph.
 * Rows come from the `tab:graph` issue store; the dependency index is rebuilt
 * only when that store applies a message, not on every store fan-out.
 *
 * @param {GraphViewOptions} options
 * @returns {GraphView}
 */
export function createGraphView({
  mount_element,
  store,
  issue_stores,
  gotoGraph,
  gotoIssue
}) {
  let destroyed = false;
  let loaded = false;
  /** @type {{ message: string, retry: (() => void) | null } | null} */
  let error = null;
  let depth_value = DEFAULT_DEPTH_VALUE;
  let show_closed = false;
  /** @type {string | null} */
  let focus_id = store.getState().graph.focus_id;

  /** Containers whose folded unlocks are drawn on the canvas. */
  /** @type {Set<string>} */
  const expanded = new Set();
  let expand_rev = 0;
  /** Plan-pane fold disclosures that are open. */
  /** @type {Set<string>} */
  const open_folds = new Set();
  /** @type {string | null} */
  let active_node = null;
  /** @type {string | null} */
  let highlight_node = null;

  let query = '';
  let picker_open = false;
  let picker_active = -1;

  /** @type {unknown} */
  let index_key = null;
  /** @type {DepIndex | null} */
  let index = null;
  /** @type {{ index: DepIndex, value: ReturnType<typeof computeSuggestions> } | null} */
  let suggestions_memo = null;
  /** @type {FocusModel | null} */
  let focus_memo = null;

  function storeKey() {
    const s = issue_stores.getStore(GRAPH_CLIENT_ID);
    return s ? s.snapshot() : null;
  }

  /** @returns {DepIndex} */
  function getIndex() {
    const key = storeKey();
    if (index === null || key !== index_key) {
      index_key = key;
      index = buildDepIndex(issue_stores.snapshotFor(GRAPH_CLIENT_ID));
    }
    return index;
  }

  function depthLimit() {
    const choice = DEPTH_CHOICES.find((c) => c.value === depth_value);
    return choice ? choice.depth : Infinity;
  }

  /**
   * @param {DepIndex} idx
   * @param {string} id
   */
  function isClosed(idx, id) {
    return idx.entries.get(id)?.status === 'closed';
  }

  /**
   * @param {DepIndex} idx
   * @param {string} focus
   * @returns {FocusModel}
   */
  function getFocusModel(idx, focus) {
    const depth = depthLimit();
    const include_closed = show_closed || isClosed(idx, focus);
    if (
      focus_memo &&
      focus_memo.index === idx &&
      focus_memo.focus === focus &&
      focus_memo.depth === depth &&
      focus_memo.include_closed === include_closed &&
      focus_memo.expand_rev === expand_rev
    ) {
      return focus_memo;
    }
    const slice = collectGraphSlice(idx, focus, {
      max_depth: depth,
      include_closed,
      expanded
    });
    const layout = layoutGraph({
      nodes: slice.nodes,
      edges: slice.edges.filter((e) => !e.implied)
    });
    focus_memo = {
      index: idx,
      focus,
      depth,
      include_closed,
      expand_rev,
      work: computeWorkOrder(idx, focus),
      unlocks: computeUnlocks(idx, focus),
      slice,
      layout
    };
    return focus_memo;
  }

  /** @param {DepIndex} idx */
  function getSuggestions(idx) {
    if (!suggestions_memo || suggestions_memo.index !== idx) {
      suggestions_memo = { index: idx, value: computeSuggestions(idx) };
    }
    return suggestions_memo.value;
  }

  /**
   * @param {DepIndex} idx
   * @param {string} id
   */
  function titleOf(idx, id) {
    return idx.entries.get(id)?.issue.title || id;
  }

  /**
   * Spoken state, with the status spelled out for an unblocked bead that
   * bd ready excludes.
   *
   * @param {DepIndex} idx
   * @param {string} id
   * @param {NodeState} state
   */
  function spokenState(idx, id, state) {
    if (state === 'held') {
      return `${STATE_SPOKEN.held}, status ${statusText(idx.entries.get(id)?.status ?? '')}`;
    }
    return STATE_SPOKEN[state];
  }

  function doRender() {
    if (destroyed) {
      return;
    }
    render(template(), mount_element);
  }

  /** @param {string | null} id */
  function refocus(id) {
    gotoGraph(id);
  }

  function resetFocusState() {
    expanded.clear();
    expand_rev++;
    open_folds.clear();
    active_node = null;
    highlight_node = null;
  }

  // Re-render only when the graph store itself applied a message
  const off_issues = issue_stores.subscribe(() => {
    if (index !== null && storeKey() === index_key) {
      return;
    }
    doRender();
  });

  /**
   * Adopt a new focus id, dropping the per-focus view state.
   *
   * @param {string | null} next
   * @returns {boolean} Whether the focus changed.
   */
  function syncFocus(next) {
    if (next === focus_id) {
      return false;
    }
    focus_id = next;
    resetFocusState();
    return true;
  }

  const off_store = store.subscribe((s) => {
    if (syncFocus(s.graph.focus_id)) {
      doRender();
    }
  });

  // ---------------------------------------------------------------- toolbar

  /** @param {DepIndex} idx */
  function pickerResults(idx) {
    return picker_open ? searchFocusCandidates(idx, query) : [];
  }

  /** @param {string} id */
  function choose(id) {
    query = '';
    picker_open = false;
    picker_active = -1;
    doRender();
    refocus(id);
  }

  /** @param {Event} ev */
  function onPickerInput(ev) {
    const input = /** @type {HTMLInputElement} */ (ev.currentTarget);
    query = input.value;
    picker_open = query.trim().length > 0;
    picker_active = -1;
    doRender();
  }

  /**
   * @param {KeyboardEvent} ev
   * @param {DepIndex} idx
   */
  function onPickerKeydown(ev, idx) {
    const results = searchFocusCandidates(idx, query);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length === 0) {
        return;
      }
      picker_open = true;
      picker_active =
        ev.key === 'ArrowDown'
          ? Math.min(picker_active + 1, results.length - 1)
          : Math.max(picker_active - 1, 0);
      doRender();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const pick = results[picker_active >= 0 ? picker_active : 0];
      if (pick) {
        choose(pick.id);
      }
    } else if (ev.key === 'Escape') {
      if (picker_open) {
        picker_open = false;
      } else {
        query = '';
      }
      picker_active = -1;
      doRender();
    }
  }

  function onPickerBlur() {
    if (picker_open) {
      picker_open = false;
      picker_active = -1;
      doRender();
    }
  }

  /** @param {Event} ev */
  function onDepthChange(ev) {
    depth_value = /** @type {HTMLSelectElement} */ (ev.currentTarget).value;
    doRender();
  }

  /** @param {Event} ev */
  function onShowClosedChange(ev) {
    show_closed = /** @type {HTMLInputElement} */ (ev.currentTarget).checked;
    doRender();
  }

  /**
   * @param {DepIndex | null} idx
   * @param {boolean} closed_focus
   */
  function toolbarTemplate(idx, closed_focus) {
    const results = idx ? pickerResults(idx) : [];
    const expanded_list = picker_open && results.length > 0;
    return html`<div class="graph-toolbar">
      <div class="graph-picker">
        <label class="visually-hidden" for=${PICKER_INPUT_ID}>Focus bead</label>
        <input
          id=${PICKER_INPUT_ID}
          class="graph-picker__input"
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded=${expanded_list}
          aria-controls=${PICKER_LIST_ID}
          aria-activedescendant=${expanded_list && picker_active >= 0
            ? `${PICKER_OPTION_PREFIX}${picker_active}`
            : nothing}
          placeholder="Find a bead by id or title"
          .value=${query}
          ?disabled=${idx === null}
          @input=${onPickerInput}
          @keydown=${(/** @type {KeyboardEvent} */ ev) =>
            idx && onPickerKeydown(ev, idx)}
          @blur=${onPickerBlur}
        />
        <ul
          id=${PICKER_LIST_ID}
          class="graph-picker__list"
          role="listbox"
          aria-label="Matching beads"
          ?hidden=${!expanded_list}
        >
          ${results.map(
            (entry, i) =>
              html`<li
                id=${`${PICKER_OPTION_PREFIX}${i}`}
                class="graph-picker__option ${i === picker_active
                  ? 'is-active'
                  : ''}"
                role="option"
                aria-selected=${i === picker_active}
                data-id=${entry.id}
                @mousedown=${(/** @type {MouseEvent} */ ev) =>
                  ev.preventDefault()}
                @click=${() => choose(entry.id)}
              >
                <span class="mono">${entry.id}</span>
                <span class="text-truncate">${entry.issue.title || ''}</span>
              </li>`
          )}
        </ul>
      </div>
      <button
        type="button"
        class="btn graph-clear"
        ?disabled=${focus_id === null}
        @click=${() => refocus(null)}
      >
        Clear focus
      </button>
      <label class="graph-control">
        Depth
        <select class="graph-depth" @change=${onDepthChange}>
          ${DEPTH_CHOICES.map(
            (c) =>
              html`<option
                value=${c.value}
                ?selected=${c.value === depth_value}
              >
                ${c.label}
              </option>`
          )}
        </select>
      </label>
      <label class="graph-control">
        <input
          type="checkbox"
          class="graph-show-closed"
          .checked=${show_closed || closed_focus}
          ?disabled=${closed_focus}
          @change=${onShowClosedChange}
        />
        Show closed
      </label>
      ${legendTemplate()}
    </div>`;
  }

  function legendTemplate() {
    return html`<ul class="graph-legend" aria-label="Legend">
      ${LEGEND.map(
        (row) =>
          html`<li class="graph-legend__item">
            <svg
              class="graph-legend__sample"
              width=${LEGEND_SAMPLE_WIDTH}
              height=${LEGEND_SAMPLE_HEIGHT}
              aria-hidden="true"
              focusable="false"
            >
              ${svg`<line
                class=${edgeClassName(row.kind, row.cycle, false)}
                x1="0"
                y1=${LEGEND_SAMPLE_HEIGHT / 2}
                x2=${LEGEND_SAMPLE_WIDTH - LEGEND_SAMPLE_HEIGHT / 2}
                y2=${LEGEND_SAMPLE_HEIGHT / 2}
                marker-end=${markerUrl(row.cycle)}
              ></line>`}
            </svg>
            <span>${row.label}</span>
          </li>`
      )}
    </ul>`;
  }

  // ------------------------------------------------------------ main states

  function template() {
    const idx = loaded && !error ? getIndex() : null;
    const closed_focus =
      idx !== null && focus_id !== null && isClosed(idx, focus_id);
    return html`<div class="graph-view">
      ${markerDefsTemplate()} ${toolbarTemplate(idx, closed_focus)}
      ${bodyTemplate(idx)}
    </div>`;
  }

  /** @param {DepIndex | null} idx */
  function bodyTemplate(idx) {
    if (error) {
      const retry = error.retry;
      return html`<div class="graph-state graph-state--error" role="alert">
        <p>Could not load the dependency graph: ${error.message}</p>
        ${retry
          ? html`<button
              type="button"
              class="btn graph-retry"
              @click=${() => {
                error = null;
                loaded = false;
                doRender();
                retry();
              }}
            >
              Retry
            </button>`
          : nothing}
      </div>`;
    }
    if (idx === null) {
      return html`<div class="graph-state" role="status">
        Loading dependency graph…
      </div>`;
    }
    if (focus_id === null) {
      return noFocusTemplate(idx);
    }
    if (!idx.entries.has(focus_id)) {
      return html`<div class="graph-state graph-state--missing" role="status">
        <p>
          <span class="mono">${focus_id}</span> was not found in this workspace.
        </p>
        <button type="button" class="btn" @click=${() => refocus(null)}>
          Clear focus
        </button>
      </div>`;
    }
    return focusTemplate(idx, focus_id);
  }

  /** @param {DepIndex} idx */
  function noFocusTemplate(idx) {
    const s = getSuggestions(idx);
    if (s.start_here.length === 0 && s.most_blocked.length === 0) {
      return html`<div class="graph-state graph-state--empty" role="status">
        No blocking dependencies yet.
      </div>`;
    }
    /**
     * @param {string} id
     * @param {string} note
     */
    const suggestion = (id, note) =>
      html`<li class="graph-suggestion">
        <button
          type="button"
          class="graph-link"
          data-id=${id}
          @click=${() => refocus(id)}
        >
          <span class="mono">${id}</span> ${titleOf(idx, id)}
        </button>
        <span class="muted">${note}</span>
      </li>`;
    return html`<div class="graph-suggestions">
      <p class="muted">
        Pick a bead to see what has to close first and what it unlocks.
      </p>
      ${s.start_here.length > 0
        ? html`<section class="graph-suggestions__group">
            <h3>Start here</h3>
            <ul class="graph-suggestions__list" data-group="start-here">
              ${s.start_here.map((it) =>
                suggestion(
                  it.id,
                  `unlocks ${plural(it.downstream, 'bead', 'beads')}`
                )
              )}
            </ul>
          </section>`
        : nothing}
      ${s.most_blocked.length > 0
        ? html`<section class="graph-suggestions__group">
            <h3>Most blocked</h3>
            <ul class="graph-suggestions__list" data-group="most-blocked">
              ${s.most_blocked.map((it) =>
                suggestion(
                  it.id,
                  `waits on ${plural(it.upstream, 'bead', 'beads')}`
                )
              )}
            </ul>
          </section>`
        : nothing}
    </div>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {string} focus
   */
  function focusTemplate(idx, focus) {
    const model = getFocusModel(idx, focus);
    const closed = isClosed(idx, focus);
    return html`${focusCardTemplate(idx, focus)}
      ${closed
        ? html`<p class="graph-notice" role="note">
            <span class="mono">${focus}</span> is closed. Showing its history,
            with closed beads included.
          </p>`
        : nothing}
      <div class="graph-body">
        ${planTemplate(idx, model)} ${canvasPaneTemplate(idx, model)}
      </div>`;
  }

  /**
   * One-line summary, e.g. "Can start now; closes after 3 open children".
   *
   * @param {DepIndex} idx
   * @param {string} id
   * @param {NodeState} state
   */
  function focusSummary(idx, id, state) {
    const prereqs = idx.prereqs_of.get(id) ?? [];
    const start_blockers = prereqs.filter(
      (l) => l.reason !== 'child' && idx.entries.has(l.id)
    ).length;
    const children = prereqs.filter((l) => l.reason === 'child').length;
    /** @type {string[]} */
    const parts = [];
    if (state === 'closed') {
      parts.push('Closed');
    } else if (state === 'cycle') {
      parts.push('Stuck in a dependency cycle');
    } else if (state === 'blocked') {
      parts.push(
        `Waits on ${plural(start_blockers, 'open prerequisite', 'open prerequisites')}`
      );
    } else if (state === 'ready') {
      parts.push('Can start now');
    } else {
      parts.push(
        `Unblocked, status ${statusText(idx.entries.get(id)?.status ?? '')}`
      );
    }
    if (state !== 'closed' && children > 0) {
      parts.push(
        `closes after ${plural(children, 'open child', 'open children')}`
      );
    }
    return parts.join('; ');
  }

  /**
   * @param {DepIndex} idx
   * @param {string} focus
   */
  function focusCardTemplate(idx, focus) {
    const entry = idx.entries.get(focus);
    const issue = entry ? entry.issue : { id: focus };
    const state = nodeState(idx, focus);
    const crumbs = ancestorIds(idx, focus).reverse();
    return html`<section
      class="graph-focus"
      aria-labelledby="graph-focus-title"
    >
      ${crumbs.length > 0
        ? html`<nav class="graph-crumbs" aria-label="Ancestors">
            <ol>
              ${crumbs.map((a) =>
                idx.entries.has(a)
                  ? html`<li>
                      <button
                        type="button"
                        class="graph-crumb"
                        data-id=${a}
                        title=${titleOf(idx, a)}
                        @click=${() => refocus(a)}
                      >
                        ${a}
                      </button>
                    </li>`
                  : html`<li class="graph-crumb is-external">${a}</li>`
              )}
            </ol>
          </nav>`
        : nothing}
      <h2 id="graph-focus-title" class="graph-focus__title">
        <span class="mono">${focus}</span>
        <span>${issue.title || ''}</span>
      </h2>
      <div class="graph-focus__meta">
        <span class="graph-state-chip is-${state}">${STATE_SHORT[state]}</span>
        <span class="graph-chip">${statusLabel(entry?.status)}</span>
        ${createPriorityBadge(issue.priority)}
        ${createTypeBadge(issue.issue_type)}
        <button
          type="button"
          class="btn graph-open-details"
          @click=${() => gotoIssue(focus)}
        >
          Open details
        </button>
      </div>
      <p class="graph-focus__summary" aria-live="polite">
        ${focusSummary(idx, focus, state)}
      </p>
    </section>`;
  }

  // --------------------------------------------------------------- plan pane

  /**
   * A refocus button plus a details button for one bead in a list.
   *
   * @param {DepIndex} idx
   * @param {string} id
   * @param {string} label - Spoken label for the refocus button.
   */
  function beadButtons(idx, id, label) {
    return html`<button
        type="button"
        class="graph-link graph-item__focus"
        data-id=${id}
        aria-label=${label}
        @click=${() => refocus(id)}
      >
        <span class="mono">${id}</span>
        <span class="graph-item__title">${titleOf(idx, id)}</span>
      </button>
      <button
        type="button"
        class="graph-item__open"
        aria-label=${`Open details for ${id}`}
        @click=${() => gotoIssue(id)}
      >
        Details
      </button>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {FocusModel} model
   */
  function planTemplate(idx, model) {
    const { work, focus } = model;
    const goal_title = titleOf(idx, focus);
    const goal_spoken = spokenState(idx, focus, work.goal_state);
    return html`<section class="graph-plan" aria-labelledby="graph-plan-title">
      <h3 id="graph-plan-title">Before you can ${work.goal} ${focus}</h3>
      ${work.has_cycle
        ? html`<p class="graph-notice" role="note">
            A dependency cycle runs through this plan; its beads cannot all
            close in order.
          </p>`
        : nothing}
      ${work.steps.length === 0
        ? html`<p class="muted">Nothing has to close first.</p>`
        : nothing}
      <ol class="graph-steps">
        ${work.steps.map(
          (step) =>
            html`<li class="graph-step" data-step=${step.step}>
              <h4 class="graph-step__title">Step ${step.step}</h4>
              <ol class="graph-step__items">
                ${step.items.map((item, i) =>
                  planItemTemplate(idx, step.step, item, i, step.items.length)
                )}
              </ol>
            </li>`
        )}
        <li class="graph-step graph-step--goal" data-step=${work.goal_step}>
          <h4 class="graph-step__title">Step ${work.goal_step}</h4>
          <p
            class="graph-goal"
            aria-label=${`Step ${work.goal_step}, goal: ${work.goal} ${goal_title}, ${goal_spoken}`}
          >
            <span class="graph-state-chip is-${work.goal_state}"
              >${STATE_SHORT[work.goal_state]}</span
            >
            Then ${work.goal} <span class="mono">${focus}</span> ${goal_title}
          </p>
        </li>
      </ol>
      ${unlocksTemplate(idx, model)} ${relatedTemplate(idx, focus)}
    </section>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {number} step
   * @param {WorkItem} item
   * @param {number} i
   * @param {number} count
   */
  function planItemTemplate(idx, step, item, i, count) {
    const label = `Step ${step}, item ${i + 1} of ${count}: ${titleOf(idx, item.id)}, ${spokenState(idx, item.id, item.state)}`;
    return html`<li class="graph-item is-${item.state}" data-id=${item.id}>
      <span class="graph-state-chip is-${item.state}"
        >${STATE_SHORT[item.state]}</span
      >
      ${beadButtons(idx, item.id, label)}
      <span class="graph-reasons">
        ${item.reasons.map(
          (r) => html`<span class="graph-chip">${planReasonText(r)}</span>`
        )}
      </span>
    </li>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {UnlockGroup} group
   */
  function unlockGroupTemplate(idx, group) {
    const state = nodeState(idx, group.id);
    const label = `${titleOf(idx, group.id)}, ${spokenState(idx, group.id, state)}`;
    const is_open = open_folds.has(group.id);
    const list_id = `${FOLD_LIST_PREFIX}${group.id}`;
    return html`<li class="graph-item is-${state}" data-id=${group.id}>
      <span class="graph-state-chip is-${state}">${STATE_SHORT[state]}</span>
      ${beadButtons(idx, group.id, label)}
      <span class="graph-reasons">
        ${group.reasons.map(
          (r) => html`<span class="graph-chip">${unlockReasonText(r)}</span>`
        )}
      </span>
      ${group.folded.length > 0
        ? html`<button
              type="button"
              class="graph-fold"
              aria-expanded=${is_open}
              aria-controls=${list_id}
              @click=${() => {
                if (is_open) {
                  open_folds.delete(group.id);
                } else {
                  open_folds.add(group.id);
                }
                doRender();
              }}
            >
              ${is_open ? 'Hide' : 'Show'}
              ${plural(group.folded.length, 'bead', 'beads')} inside ${group.id}
            </button>
            <ul id=${list_id} class="graph-fold__list" ?hidden=${!is_open}>
              ${group.folded.map((id) => {
                const s = nodeState(idx, id);
                return html`<li class="graph-item is-${s}" data-id=${id}>
                  ${beadButtons(
                    idx,
                    id,
                    `${titleOf(idx, id)}, ${spokenState(idx, id, s)}`
                  )}
                </li>`;
              })}
            </ul>`
        : nothing}
    </li>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {FocusModel} model
   */
  function unlocksTemplate(idx, model) {
    const { unlocks, focus } = model;
    const none = unlocks.total === 0 && unlocks.still_waiting.length === 0;
    return html`<section
      class="graph-unlocks"
      aria-labelledby="graph-unlocks-title"
    >
      <h3 id="graph-unlocks-title">Completing ${focus} unlocks</h3>
      ${none ? html`<p class="muted">Nothing waits on ${focus}.</p>` : nothing}
      ${unlocks.immediate.length > 0
        ? html`<h4>Ready right after</h4>
            <ul class="graph-unlocks__list" data-group="immediate">
              ${unlocks.immediate.map((g) => unlockGroupTemplate(idx, g))}
            </ul>`
        : nothing}
      ${unlocks.waves.length > 0
        ? html`<h4>Later</h4>
            <ol class="graph-unlocks__waves" data-group="later">
              ${unlocks.waves.map(
                (wave) =>
                  html`<li>
                    <ul class="graph-unlocks__list">
                      ${wave.map((g) => unlockGroupTemplate(idx, g))}
                    </ul>
                  </li>`
              )}
            </ol>`
        : nothing}
      ${unlocks.still_waiting.length > 0
        ? html`<h4>Still waiting</h4>
            <ul class="graph-unlocks__list" data-group="still-waiting">
              ${unlocks.still_waiting.map((w) => {
                const s = nodeState(idx, w.id);
                return html`<li class="graph-item is-${s}" data-id=${w.id}>
                  <span class="graph-state-chip is-${s}"
                    >${STATE_SHORT[s]}</span
                  >
                  ${beadButtons(
                    idx,
                    w.id,
                    `${titleOf(idx, w.id)}, ${spokenState(idx, w.id, s)}`
                  )}
                  ${w.waits_on.length > 0
                    ? html`<span class="graph-waits muted"
                        >(also needs
                        ${listNames(w.waits_on, NAMES_SHOWN)})</span
                      >`
                    : nothing}
                </li>`;
              })}
            </ul>`
        : nothing}
    </section>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {string} focus
   */
  function relatedTemplate(idx, focus) {
    const related = idx.entries.get(focus)?.related ?? [];
    return html`<section
      class="graph-related"
      aria-labelledby="graph-related-title"
    >
      <h3 id="graph-related-title">Related (does not affect order)</h3>
      ${related.length === 0
        ? html`<p class="muted">None.</p>`
        : html`<ul class="graph-related__list">
            ${related.map(
              (r) =>
                html`<li class="graph-item" data-id=${r.id}>
                  <span class="graph-chip"
                    >${r.direction === 'out'
                      ? r.type
                      : `${r.type} (from)`}</span
                  >
                  ${beadButtons(idx, r.id, `${titleOf(idx, r.id)}, ${r.type}`)}
                </li>`
            )}
          </ul>`}
    </section>`;
  }

  // -------------------------------------------------------------- graph pane

  /**
   * @param {string} kind
   * @param {boolean} cycle
   * @param {boolean} highlighted
   */
  function edgeClassName(kind, cycle, highlighted) {
    return [
      'graph-edge',
      `graph-edge--${kind}`,
      cycle ? 'is-cycle' : '',
      highlighted ? 'is-highlighted' : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** @param {boolean} cycle */
  function markerUrl(cycle) {
    return `url(#${cycle ? CYCLE_MARKER_ID : ARROW_MARKER_ID})`;
  }

  function markerDefsTemplate() {
    return html`<svg class="graph-defs" aria-hidden="true" focusable="false">
      <defs>
        <marker
          id=${ARROW_MARKER_ID}
          class="graph-marker"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
        <marker
          id=${CYCLE_MARKER_ID}
          class="graph-marker graph-marker--cycle"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 4 0 L 10 5 L 4 10 z M 0 0 L 2 0 L 2 10 L 0 10 z"></path>
        </marker>
      </defs>
    </svg>`;
  }

  /** @param {number} column */
  function regionOf(column) {
    return REGIONS.find((r) => r.match(column)) ?? REGIONS[1];
  }

  /** @param {GraphLayout} layout */
  function columnHeadsTemplate(layout) {
    return REGIONS.map((region) => {
      const nodes = layout.nodes.filter((n) => region.match(n.column));
      if (nodes.length === 0) {
        return nothing;
      }
      const left = Math.min(...nodes.map((n) => n.x));
      const right = Math.max(...nodes.map((n) => n.x + n.width));
      return html`<span
        class="graph-column-head"
        style=${`left:${left}px;width:${right - left}px`}
        >${region.label}</span
      >`;
    });
  }

  /**
   * The node an arrow key moves to: up and down within the column, left and
   * right to the nearest row of the adjacent column.
   *
   * @param {GraphLayout} layout
   * @param {string} id
   * @param {string} key
   * @returns {string | null}
   */
  function neighborOf(layout, id, key) {
    const node = layout.nodes.find((n) => n.id === id);
    if (!node) {
      return null;
    }
    const xs = Array.from(new Set(layout.nodes.map((n) => n.x))).sort(
      (a, b) => a - b
    );
    /** @param {number} x */
    const columnAt = (x) =>
      layout.nodes.filter((n) => n.x === x).sort((a, b) => a.row - b.row);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const col = columnAt(node.x);
      const next = col[col.indexOf(node) + (key === 'ArrowUp' ? -1 : 1)];
      return next ? next.id : null;
    }
    const x = xs[xs.indexOf(node.x) + (key === 'ArrowLeft' ? -1 : 1)];
    if (x === undefined) {
      return null;
    }
    const mid = node.y + node.height / 2;
    /** @type {LayoutNode | null} */
    let best = null;
    for (const n of columnAt(x)) {
      if (
        best === null ||
        Math.abs(n.y + n.height / 2 - mid) <
          Math.abs(best.y + best.height / 2 - mid)
      ) {
        best = n;
      }
    }
    return best ? best.id : null;
  }

  /** @param {string} id */
  function focusNodeButton(id) {
    for (const el of Array.from(
      mount_element.querySelectorAll('.graph-node')
    )) {
      if (el instanceof HTMLElement && el.dataset.id === id) {
        el.focus();
        return;
      }
    }
  }

  /**
   * @param {KeyboardEvent} ev
   * @param {FocusModel} model
   * @param {string} id
   */
  function onNodeKeydown(ev, model, id) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) {
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.shiftKey) {
        gotoIssue(id);
      } else {
        refocus(id);
      }
      return;
    }
    if (ev.key === 'o' && !ev.shiftKey) {
      ev.preventDefault();
      gotoIssue(id);
      return;
    }
    /** @type {string | null} */
    let next = null;
    if (ev.key === 'Home') {
      next = model.focus;
    } else if (
      ev.key === 'ArrowUp' ||
      ev.key === 'ArrowDown' ||
      ev.key === 'ArrowLeft' ||
      ev.key === 'ArrowRight'
    ) {
      next = neighborOf(model.layout, id, ev.key);
    } else {
      return;
    }
    ev.preventDefault();
    if (next !== null && next !== id) {
      active_node = next;
      doRender();
      focusNodeButton(next);
    }
  }

  /** @param {string | null} id */
  function setHighlight(id) {
    if (highlight_node !== id) {
      highlight_node = id;
      doRender();
    }
  }

  /**
   * @param {DepIndex} idx
   * @param {FocusModel} model
   */
  function canvasPaneTemplate(idx, model) {
    const { slice, layout, focus } = model;
    const drawn_edges = layout.edges.length;
    const folded_of = new Map(slice.folded.map((f) => [f.id, f.ids]));
    const active =
      active_node !== null && layout.nodes.some((n) => n.id === active_node)
        ? active_node
        : focus;
    const levels = plural(slice.depth, 'level', 'levels');
    return html`<section
      class="graph-canvas-pane"
      aria-labelledby="graph-canvas-title"
    >
      <h3 id="graph-canvas-title">Graph</h3>
      ${slice.truncated
        ? html`<p class="graph-banner" role="status">
            Showing ${levels} around ${focus}: the full graph has more than
            ${MAX_GRAPH_NODES} beads. Pick a nearer bead to see further.
          </p>`
        : nothing}
      ${drawn_edges === 0
        ? html`<p class="graph-state graph-state--no-edges">
            No dependency edges around ${focus}.
          </p>`
        : nothing}
      <div class="graph-scroll">
        <div
          class="graph-columns"
          style=${`width:${layout.width}px`}
          aria-hidden="true"
        >
          ${columnHeadsTemplate(layout)}
        </div>
        <div
          class="graph-canvas ${highlight_node !== null ? 'has-highlight' : ''}"
          role="group"
          aria-label=${`Dependency graph around ${focus}`}
          style=${`width:${layout.width}px;height:${layout.height}px`}
        >
          <svg
            class="graph-edges"
            width=${layout.width}
            height=${layout.height}
            viewBox=${`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
            focusable="false"
          >
            ${layout.edges.map((e) => edgeTemplate(e))}
          </svg>
          ${layout.nodes.map((n) =>
            nodeTemplate(idx, model, n, n.id === active, folded_of)
          )}
          ${layout.nodes.map((n) => foldChipTemplate(n, folded_of))}
        </div>
      </div>
      ${slice.overflow.map(
        (o) =>
          html`<p class="graph-note muted">
            ${plural(
              o.ids.length,
              o.column < 0 ? 'more prerequisite' : 'more unlock',
              o.column < 0 ? 'more prerequisites' : 'more unlocks'
            )}
            not drawn: ${listNames(o.ids, NAMES_SHOWN)}.
          </p>`
      )}
    </section>`;
  }

  /** @param {LayoutEdge} e */
  function edgeTemplate(e) {
    const lit =
      highlight_node !== null &&
      (e.from === highlight_node || e.to === highlight_node);
    return svg`<path
      class=${edgeClassName(e.kind, e.cycle, lit)}
      data-from=${e.from}
      data-to=${e.to}
      d=${e.path}
      marker-end=${markerUrl(e.cycle)}
    ></path>`;
  }

  /**
   * @param {DepIndex} idx
   * @param {FocusModel} model
   * @param {LayoutNode} n
   * @param {boolean} is_active
   * @param {Map<string, string[]>} folded_of
   */
  function nodeTemplate(idx, model, n, is_active, folded_of) {
    const state = nodeState(idx, n.id);
    const folded = folded_of.get(n.id) ?? [];
    const title = titleOf(idx, n.id);
    const label = [
      `${n.id}: ${title}`,
      spokenState(idx, n.id, state),
      regionOf(n.column).role,
      folded.length > 0
        ? `${plural(folded.length, 'bead', 'beads')} folded inside`
        : ''
    ]
      .filter(Boolean)
      .join(', ');
    return html`<button
      type="button"
      class="graph-node is-${state} ${n.id === model.focus ? 'is-focus' : ''}"
      data-id=${n.id}
      tabindex=${is_active ? 0 : -1}
      aria-label=${label}
      style=${`left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px`}
      @keydown=${(/** @type {KeyboardEvent} */ ev) =>
        onNodeKeydown(ev, model, n.id)}
      @click=${(/** @type {MouseEvent} */ ev) => {
        active_node = n.id;
        if (ev.shiftKey) {
          gotoIssue(n.id);
        } else {
          refocus(n.id);
        }
      }}
      @focus=${() => setHighlight(n.id)}
      @blur=${() => setHighlight(null)}
      @mouseenter=${() => setHighlight(n.id)}
      @mouseleave=${() => setHighlight(null)}
    >
      <span class="graph-node__head">
        <span class="mono">${n.id}</span>
        <span class="graph-state-chip is-${state}">${STATE_SHORT[state]}</span>
      </span>
      <span class="graph-node__title text-truncate">${title}</span>
    </button>`;
  }

  /**
   * @param {LayoutNode} n
   * @param {Map<string, string[]>} folded_of
   */
  function foldChipTemplate(n, folded_of) {
    const folded = folded_of.get(n.id) ?? [];
    if (folded.length === 0) {
      return nothing;
    }
    return html`<button
      type="button"
      class="graph-fold-chip"
      data-id=${n.id}
      aria-label=${`Show ${plural(folded.length, 'bead', 'beads')} folded inside ${n.id}`}
      style=${`left:${n.x + n.width - FOLD_CHIP_WIDTH}px;top:${n.y + n.height - FOLD_CHIP_DROP}px;width:${FOLD_CHIP_WIDTH}px`}
      @click=${() => {
        expanded.add(n.id);
        expand_rev++;
        doRender();
      }}
    >
      +${folded.length}
    </button>`;
  }

  return {
    load() {
      syncFocus(store.getState().graph.focus_id);
      doRender();
    },
    /** @param {boolean} value */
    setLoaded(value) {
      loaded = value;
      if (value) {
        error = null;
      }
      doRender();
    },
    /**
     * @param {string | null} message - Null clears the error.
     * @param {() => void} [retry] - Called by the Retry button.
     */
    setError(message, retry) {
      error = message === null ? null : { message, retry: retry ?? null };
      doRender();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      off_issues();
      off_store();
      render(nothing, mount_element);
      destroyed = true;
      index = null;
      focus_memo = null;
      suggestions_memo = null;
    }
  };
}
