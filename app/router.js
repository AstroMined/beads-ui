import { graphHashFor, issueHashFor, viewHashFor } from './utils/issue-url.js';
import { debug } from './utils/logging.js';

/**
 * @import { AppState, StatePatch, ViewName } from './state.js'
 */

/**
 * Hash-based router for tabs (issues/epics/board/graph/settings), the graph
 * focus and deep-linked issue ids.
 */

/**
 * Read one query param from an application hash.
 *
 * @param {string} hash
 * @param {string} name
 * @returns {string | null}
 */
function readHashParam(hash, name) {
  const h = String(hash || '');
  const frag = h.startsWith('#') ? h.slice(1) : h;
  const qIndex = frag.indexOf('?');
  if (qIndex < 0) {
    return null;
  }
  const value = new URLSearchParams(frag.slice(qIndex + 1)).get(name);
  return value ? decodeURIComponent(value) : null;
}

/**
 * Parse an application hash and extract the selected issue id.
 * Supports canonical form "#/(issues|epics|board|graph)?issue=<id>" and
 * legacy "#/issue/<id>" which we will rewrite to the canonical form.
 *
 * @param {string} hash
 * @returns {string | null}
 */
export function parseHash(hash) {
  const id = readHashParam(hash, 'issue');
  if (id) {
    return id;
  }
  // Legacy pattern: #/issue/<id>
  const h = String(hash || '');
  const frag = h.startsWith('#') ? h.slice(1) : h;
  const m = /^\/issue\/([^\s?#]+)/.exec(frag);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

/**
 * Parse the current view from hash.
 *
 * @param {string} hash
 * @returns {ViewName}
 */
export function parseView(hash) {
  const h = String(hash || '');
  if (/^#\/epics(\b|\/|$)/.test(h)) {
    return 'epics';
  }
  if (/^#\/board(\b|\/|$)/.test(h)) {
    return 'board';
  }
  if (/^#\/graph(\b|\/|$)/.test(h)) {
    return 'graph';
  }
  if (/^#\/settings(\b|\/|$)/.test(h)) {
    return 'settings';
  }
  // Default to issues (also covers #/issues and unknown/empty)
  return 'issues';
}

/**
 * Parse the graph focus id from hash. Only the graph view carries a focus;
 * a focus param on any other view is ignored.
 *
 * @param {string} hash
 * @returns {string | null}
 */
export function parseFocus(hash) {
  if (parseView(hash) !== 'graph') {
    return null;
  }
  return readHashParam(hash, 'focus');
}

/**
 * @param {{ getState: () => AppState, setState: (patch: StatePatch) => void }} store
 */
export function createHashRouter(store) {
  const log = debug('router');

  /**
   * The current graph focus, or null when not on the graph view.
   *
   * @returns {string | null}
   */
  function currentFocus() {
    const s = store.getState();
    return s.view === 'graph' ? s.graph.focus_id : null;
  }

  /** @type {(ev?: HashChangeEvent) => any} */
  const onHashChange = () => {
    const hash = window.location.hash || '';
    // Rewrite legacy #/issue/<id> to canonical #/issues?issue=<id>
    const legacyMatch = /^#\/issue\/([^\s?#]+)/.exec(hash);
    if (legacyMatch && legacyMatch[1]) {
      const id = decodeURIComponent(legacyMatch[1]);
      // Update state immediately for consumers expecting sync selection
      store.setState({ selected_id: id, view: 'issues' });
      const next = issueHashFor('issues', id);
      if (window.location.hash !== next) {
        window.location.hash = next;
        return; // will trigger handler again
      }
    }
    const id = parseHash(hash);
    const view = parseView(hash);
    const focus_id = parseFocus(hash);
    log('hash change → view=%s id=%s focus=%s', view, id, focus_id);
    store.setState({ selected_id: id, view, graph: { focus_id } });
  };

  return {
    start() {
      window.addEventListener('hashchange', onHashChange);
      onHashChange();
    },
    stop() {
      window.removeEventListener('hashchange', onHashChange);
    },
    /**
     * Open an issue over the current view, keeping the focus on graph.
     *
     * @param {string} id
     */
    gotoIssue(id) {
      const view = store.getState().view || 'issues';
      const focus_id = currentFocus();
      const next =
        view === 'graph' ? graphHashFor(focus_id, id) : issueHashFor(view, id);
      log('goto issue %s (view=%s)', id, view);
      if (window.location.hash !== next) {
        window.location.hash = next;
      } else {
        // Force state update even if hash is the same
        store.setState({ selected_id: id, view, graph: { focus_id } });
      }
    },
    /**
     * Navigate to the graph view centered on `id`, or to the unfocused graph
     * when `id` is null. Any open issue dialog is dropped.
     *
     * @param {string | null} id
     */
    gotoGraph(id) {
      const next = graphHashFor(id);
      log('goto graph (focus=%s)', id || '');
      if (window.location.hash !== next) {
        window.location.hash = next;
      } else {
        // Force state update even if hash is the same
        store.setState({
          view: 'graph',
          selected_id: null,
          graph: { focus_id: id }
        });
      }
    },
    /**
     * Navigate to a top-level view, keeping the selected issue and, while on
     * the graph, the focus.
     *
     * @param {ViewName} view
     */
    gotoView(view) {
      const id = store.getState().selected_id;
      const focus_id = view === 'graph' ? currentFocus() : null;
      const next =
        view === 'graph'
          ? graphHashFor(focus_id, id)
          : id
            ? issueHashFor(view, id)
            : viewHashFor(view);
      log('goto view %s (id=%s)', view, id || '');
      if (window.location.hash !== next) {
        window.location.hash = next;
      } else {
        store.setState({ view, selected_id: null, graph: { focus_id } });
      }
    }
  };
}
