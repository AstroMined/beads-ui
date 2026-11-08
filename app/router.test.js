import { afterEach, describe, expect, test } from 'vitest';
import {
  createHashRouter,
  parseFocus,
  parseHash,
  parseView
} from './router.js';
import { createStore } from './state.js';

/**
 * Set the hash and deliver the hashchange event synchronously.
 *
 * @param {string} hash
 */
function setHash(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Start a router over a fresh store at the given hash.
 *
 * @param {string} hash
 */
function setup(hash) {
  window.location.hash = hash;
  const store = createStore();
  const router = createHashRouter(store);
  router.start();
  return { store, router };
}

describe('router', () => {
  /** @type {(() => void) | null} */
  let stop = null;

  afterEach(() => {
    if (stop) {
      stop();
      stop = null;
    }
    window.location.hash = '';
  });

  test('parseHash extracts id', () => {
    expect(parseHash('#/issues?issue=UI-5')).toBe('UI-5');
    expect(parseHash('#/issue/UI-5')).toBe('UI-5');
    expect(parseHash('#/graph?focus=UI-1&issue=UI-5')).toBe('UI-5');
    expect(parseHash('#/anything')).toBeNull();
  });

  test('router updates store and gotoIssue updates hash', () => {
    document.body.innerHTML = '<div></div>';
    const { store, router } = setup('');
    stop = router.stop;

    setHash('#/issue/UI-10');
    expect(store.getState().selected_id).toBe('UI-10');

    router.gotoIssue('UI-11');
    expect(window.location.hash).toBe('#/issues?issue=UI-11');
  });

  test('parseView resolves from hash and defaults to issues', () => {
    expect(parseView('#/issues')).toBe('issues');
    expect(parseView('#/epics')).toBe('epics');
    expect(parseView('#/board')).toBe('board');
    expect(parseView('#/graph')).toBe('graph');
    expect(parseView('#/graph?focus=UI-1')).toBe('graph');
    expect(parseView('#/settings')).toBe('settings');
    expect(parseView('')).toBe('issues');
    expect(parseView('#/unknown')).toBe('issues');
  });

  test('parseFocus reads the focus only on the graph view', () => {
    expect(parseFocus('#/graph?focus=UI-1')).toBe('UI-1');
    expect(parseFocus('#/graph?issue=UI-2&focus=UI-1')).toBe('UI-1');
    expect(parseFocus('#/graph?focus=a%20b')).toBe('a b');
    expect(parseFocus('#/graph')).toBeNull();
    expect(parseFocus('#/graph?focus=')).toBeNull();
    expect(parseFocus('#/board?focus=UI-1')).toBeNull();
    expect(parseFocus('')).toBeNull();
  });

  test('a graph hash sets the view, focus and selection', () => {
    const { store, router } = setup('#/graph?focus=UI-1&issue=UI-2');
    stop = router.stop;
    const s = store.getState();
    expect(s.view).toBe('graph');
    expect(s.graph.focus_id).toBe('UI-1');
    expect(s.selected_id).toBe('UI-2');

    setHash('#/board');
    expect(store.getState().view).toBe('board');
    expect(store.getState().graph.focus_id).toBeNull();
  });

  test('gotoGraph sets the focus and drops the open issue', () => {
    const { store, router } = setup('#/board?issue=UI-9');
    stop = router.stop;

    router.gotoGraph('UI-1');
    expect(window.location.hash).toBe('#/graph?focus=UI-1');

    router.gotoGraph(null);
    expect(window.location.hash).toBe('#/graph');
    setHash(window.location.hash);
    expect(store.getState().graph.focus_id).toBeNull();
    expect(store.getState().selected_id).toBeNull();
  });

  test('gotoGraph emits when the hash is unchanged', () => {
    const { store, router } = setup('#/graph?focus=UI-1');
    stop = router.stop;
    // Diverge the store from the hash so only a forced emit restores it
    store.setState({ view: 'board', selected_id: 'UI-9' });
    /** @type {string[]} */
    const views = [];
    store.subscribe((s) => views.push(s.view));

    router.gotoGraph('UI-1');
    expect(window.location.hash).toBe('#/graph?focus=UI-1');
    expect(views).toEqual(['graph']);
    expect(store.getState().selected_id).toBeNull();
    expect(store.getState().graph.focus_id).toBe('UI-1');
  });

  test('gotoIssue keeps the focus while on graph', () => {
    const { router } = setup('#/graph?focus=UI-1');
    stop = router.stop;

    router.gotoIssue('UI-2');
    expect(window.location.hash).toBe('#/graph?focus=UI-1&issue=UI-2');
  });

  test('gotoIssue on an unchanged graph hash re-emits with the focus', () => {
    const { store, router } = setup('#/graph?focus=UI-1&issue=UI-2');
    stop = router.stop;
    store.setState({ selected_id: null });

    router.gotoIssue('UI-2');
    const s = store.getState();
    expect(s.selected_id).toBe('UI-2');
    expect(s.view).toBe('graph');
    expect(s.graph.focus_id).toBe('UI-1');
  });

  test('gotoView keeps the focus while on graph', () => {
    const { store, router } = setup('#/graph?focus=UI-1&issue=UI-2');
    stop = router.stop;
    store.setState({ selected_id: null });

    router.gotoView('graph');
    expect(window.location.hash).toBe('#/graph?focus=UI-1');
  });

  test('gotoView into graph from another view starts unfocused', () => {
    const { router } = setup('#/board');
    stop = router.stop;

    router.gotoView('graph');
    expect(window.location.hash).toBe('#/graph');
  });

  test('gotoView out of graph drops the focus and keeps the issue', () => {
    const { store, router } = setup('#/graph?focus=UI-1&issue=UI-2');
    stop = router.stop;

    router.gotoView('epics');
    expect(window.location.hash).toBe('#/epics?issue=UI-2');
    setHash(window.location.hash);
    expect(store.getState().graph.focus_id).toBeNull();
  });

  test('gotoView still routes the original views', () => {
    const { store, router } = setup('#/issues');
    stop = router.stop;

    router.gotoView('board');
    expect(window.location.hash).toBe('#/board');
    setHash(window.location.hash);
    expect(store.getState().view).toBe('board');

    router.gotoView('settings');
    expect(window.location.hash).toBe('#/settings');
  });
});
