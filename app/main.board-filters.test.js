import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    async send() {
      return null;
    },
    on() {
      return () => {};
    },
    close() {},
    getState() {
      return 'open';
    }
  })
}));

const FILTERS_KEY = 'beads-ui.board-filters';

const EMPTY_FILTERS = {
  parent: null,
  assignee: null,
  types: [],
  priorities: [],
  labels: []
};

/** @type {ReturnType<typeof vi.spyOn>} */
let window_listeners;

beforeEach(() => {
  window.localStorage.clear();
  window_listeners = vi.spyOn(window, 'addEventListener');
});

afterEach(() => {
  for (const [type, listener] of window_listeners.mock.calls) {
    window.removeEventListener(type, listener);
  }
  vi.restoreAllMocks();
});

/** Boot on the board, then route away so the store persists its state. */
function bootAndPersist() {
  window.location.hash = '#/board';
  document.body.innerHTML = '<main id="app"></main>';
  bootstrap(/** @type {HTMLElement} */ (document.getElementById('app')));
  window.location.hash = '#/issues';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** @returns {unknown} */
function storedFilters() {
  return JSON.parse(String(window.localStorage.getItem(FILTERS_KEY)));
}

describe('persisted board filters', () => {
  test('a legacy single-type record is rewritten in the current shape', () => {
    window.localStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({ type: 'bug', assignee: 'ada', priorities: [1, 9] })
    );

    bootAndPersist();

    expect(storedFilters()).toEqual({
      ...EMPTY_FILTERS,
      assignee: 'ada',
      types: ['bug'],
      priorities: [1]
    });
  });

  test('garbage JSON falls back to empty filters without throwing', () => {
    window.localStorage.setItem(FILTERS_KEY, '{not json');

    expect(() => bootAndPersist()).not.toThrow();

    expect(storedFilters()).toEqual(EMPTY_FILTERS);
    expect(
      /** @type {HTMLElement} */ (document.getElementById('issues-root')).hidden
    ).toBe(false);
  });
});
