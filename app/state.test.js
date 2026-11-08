import { describe, expect, test } from 'vitest';
import {
  VIEW_NAMES,
  boardFiltersEqual,
  createEmptyBoardFilters,
  createStore,
  hasActiveBoardFilters,
  isViewName,
  normalizeBoardFilters
} from './state.js';

describe('state store', () => {
  test('get/set/subscribe works and dedupes unchanged', () => {
    const store = createStore();
    const seen = [];
    const off = store.subscribe((s) => seen.push(s));

    store.setState({ selected_id: 'UI-1' });
    store.setState({ filters: { status: 'open' } });
    // no-op (unchanged)
    store.setState({ filters: { status: 'open' } });
    off();

    expect(seen.length).toBe(2);
    const state = store.getState();
    expect(state.selected_id).toBe('UI-1');
    expect(state.filters.status).toBe('open');
  });

  test('workspace change detected for database path changes', () => {
    const store = createStore({
      workspace: {
        current: { path: '/a', database: '/a/db1' },
        available: [{ path: '/a', database: '/a/db1' }]
      }
    });
    const seen = [];
    store.subscribe((s) => seen.push(s));

    // Change database path only (same workspace path)
    store.setState({
      workspace: {
        current: { path: '/a', database: '/a/db2' },
        available: [{ path: '/a', database: '/a/db2' }]
      }
    });

    expect(seen.length).toBe(1);
    expect(store.getState().workspace.current?.database).toBe('/a/db2');
  });

  test('workspace change detected for available array content changes', () => {
    const store = createStore({
      workspace: {
        current: { path: '/a', database: '/a/db' },
        available: [
          { path: '/a', database: '/a/db' },
          { path: '/b', database: '/b/db' }
        ]
      }
    });
    const seen = [];
    store.subscribe((s) => seen.push(s));

    // Change available content (same length, different paths)
    store.setState({
      workspace: {
        available: [
          { path: '/a', database: '/a/db' },
          { path: '/c', database: '/c/db' }
        ]
      }
    });

    expect(seen.length).toBe(1);
  });
});

describe('board filters', () => {
  test('migrates a legacy single type to types', () => {
    const filters = normalizeBoardFilters({
      parent: 'UI-1',
      assignee: 'alice',
      type: 'bug'
    });

    expect(filters).toEqual({
      parent: 'UI-1',
      assignee: 'alice',
      types: ['bug'],
      priorities: [],
      labels: []
    });
  });

  test('prefers a types array over a legacy type', () => {
    const filters = normalizeBoardFilters({ type: 'bug', types: ['task'] });

    expect(filters.types).toEqual(['task']);
  });

  test('drops invalid values, dedupes and sorts arrays', () => {
    const filters = normalizeBoardFilters({
      parent: '',
      assignee: 42,
      types: ['task', 'bug', 'task', '', null, 3],
      priorities: [3, 1, 3, -1, 5, 1.5, '2', NaN, 0],
      labels: 'frontend'
    });

    expect(filters).toEqual({
      parent: null,
      assignee: null,
      types: ['bug', 'task'],
      priorities: [0, 1, 3],
      labels: []
    });
  });

  test('returns empty filters for non-object input', () => {
    for (const value of [null, undefined, 'x', 7, ['bug']]) {
      expect(normalizeBoardFilters(value)).toEqual(createEmptyBoardFilters());
    }
  });

  test('createStore normalizes initial board filters', () => {
    const store = createStore({
      board: { board_filters: { type: 'epic', priorities: [2, 2, 9] } }
    });

    expect(store.getState().board.board_filters).toEqual({
      parent: null,
      assignee: null,
      types: ['epic'],
      priorities: [2],
      labels: []
    });
  });

  test('setState normalizes a patch and keeps unpatched fields', () => {
    const store = createStore({
      board: { board_filters: { assignee: 'alice' } }
    });

    store.setState({
      board: { board_filters: { labels: ['ui', 'api', 'ui'] } }
    });

    const filters = store.getState().board.board_filters;
    expect(filters.assignee).toBe('alice');
    expect(filters.labels).toEqual(['api', 'ui']);
  });

  test('setState does not emit for a new array with equal content', () => {
    const store = createStore({
      board: { board_filters: { types: ['bug', 'task'], priorities: [1] } }
    });
    const before = store.getState().board.board_filters;
    const seen = [];
    store.subscribe((s) => seen.push(s));

    store.setState({
      board: { board_filters: { types: ['task', 'bug'], priorities: [1, 1] } }
    });

    expect(seen.length).toBe(0);
    expect(store.getState().board.board_filters).toBe(before);
  });

  test('setState emits when array content changes', () => {
    const store = createStore();
    const seen = [];
    store.subscribe((s) => seen.push(s));

    store.setState({ board: { board_filters: { priorities: [0] } } });

    expect(seen.length).toBe(1);
    expect(store.getState().board.board_filters.priorities).toEqual([0]);
  });

  test('boardFiltersEqual compares content', () => {
    const a = normalizeBoardFilters({ types: ['bug'], labels: ['ui'] });
    const b = normalizeBoardFilters({ types: ['bug'], labels: ['ui'] });
    const c = normalizeBoardFilters({ types: ['bug'], labels: ['api'] });

    expect(boardFiltersEqual(a, b)).toBe(true);
    expect(boardFiltersEqual(a, c)).toBe(false);
  });

  test('hasActiveBoardFilters reports any narrowing filter', () => {
    expect(hasActiveBoardFilters(createEmptyBoardFilters())).toBe(false);
    expect(
      hasActiveBoardFilters(normalizeBoardFilters({ parent: 'UI-1' }))
    ).toBe(true);
    expect(
      hasActiveBoardFilters(normalizeBoardFilters({ priorities: [4] }))
    ).toBe(true);
    expect(
      hasActiveBoardFilters(normalizeBoardFilters({ labels: ['ui'] }))
    ).toBe(true);
  });
});

describe('graph state', () => {
  test('focus defaults to null', () => {
    const store = createStore();

    expect(store.getState().graph).toEqual({ focus_id: null });
  });

  test('emits when the focus changes and not when it is unchanged', () => {
    const store = createStore();
    /** @type {import('./state.js').AppState[]} */
    const seen = [];
    store.subscribe((s) => seen.push(s));

    store.setState({ graph: { focus_id: 'UI-7' } });
    store.setState({ graph: { focus_id: 'UI-7' } });
    store.setState({ graph: { focus_id: null } });

    expect(seen.length).toBe(2);
    expect(seen[0].graph.focus_id).toBe('UI-7');
    expect(store.getState().graph.focus_id).toBeNull();
  });

  test('leaves the focus untouched when a patch omits it', () => {
    const store = createStore({ graph: { focus_id: 'UI-3' } });

    store.setState({ selected_id: 'UI-4' });

    expect(store.getState().graph.focus_id).toBe('UI-3');
  });
});

describe('view names', () => {
  test('includes the graph view', () => {
    expect(VIEW_NAMES).toContain('graph');
  });

  test('isViewName accepts known views only', () => {
    for (const name of VIEW_NAMES) {
      expect(isViewName(name)).toBe(true);
    }
    expect(isViewName('nope')).toBe(false);
    expect(isViewName(null)).toBe(false);
    expect(isViewName(1)).toBe(false);
  });
});
