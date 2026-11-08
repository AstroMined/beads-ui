/**
 * @import { ViewName } from '../state.js'
 */

/**
 * Build a view hash with optional query params. Params are emitted in the
 * order focus, then issue. The focus is only meaningful on the graph view,
 * so it is dropped for every other view.
 *
 * @param {ViewName} view
 * @param {{ focus?: string | null, issue?: string | null }} [params]
 * @returns {string}
 */
export function viewHashFor(view, params = {}) {
  /** @type {string[]} */
  const parts = [];
  if (view === 'graph' && params.focus) {
    parts.push(`focus=${encodeURIComponent(params.focus)}`);
  }
  if (params.issue) {
    parts.push(`issue=${encodeURIComponent(params.issue)}`);
  }
  return parts.length > 0 ? `#/${view}?${parts.join('&')}` : `#/${view}`;
}

/**
 * Build a graph hash centered on a focus issue, optionally with the detail
 * dialog open on another issue.
 *
 * @param {string | null} focus
 * @param {string | null} [issue]
 * @returns {string}
 */
export function graphHashFor(focus, issue) {
  return viewHashFor('graph', { focus, issue });
}

/**
 * Build a canonical issue hash that retains the view.
 *
 * @param {ViewName} view
 * @param {string} id
 * @returns {string}
 */
export function issueHashFor(view, id) {
  const v =
    view === 'epics' || view === 'board' || view === 'graph' ? view : 'issues';
  return viewHashFor(v, { issue: id });
}
