import { describe, expect, test } from 'vitest';
import { createStore } from './state.js';

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
