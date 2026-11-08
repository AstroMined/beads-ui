/**
 * Subscription constants for the open-set `graph-issues` list, shared by the
 * Graph tab and the Board's dependency index.
 */

/** Subscription type that serves every non-closed bead with its edges. */
export const GRAPH_ISSUES_TYPE = 'graph-issues';

/** Client id of the Graph tab's open-set subscription. */
export const GRAPH_CLIENT_ID = 'tab:graph';

/**
 * Client id of the Board's dependency index subscription. It does not start
 * with `tab:board:`, so it cannot collide with a column id.
 */
export const BOARD_INDEX_CLIENT_ID = 'tab:board-index';

/**
 * Subscription spec for the open-set list. It takes no params.
 *
 * @returns {{ type: typeof GRAPH_ISSUES_TYPE }}
 */
export function graphIssuesSpec() {
  return { type: GRAPH_ISSUES_TYPE };
}
