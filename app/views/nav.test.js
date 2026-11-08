import { describe, expect, test, vi } from 'vitest';
import { createTopNav } from './nav.js';

function setup() {
  document.body.innerHTML = '<div id="m"></div>';
  const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
  const store = {
    state: { view: 'issues' },
    getState() {
      return this.state;
    },
    /** @param {any} v */
    set(v) {
      this.state = { ...this.state, ...v };
    },
    /** @param {(s: any) => void} fn */
    subscribe(fn) {
      // simplistic subscription for test
      this._fn = fn;
      return () => void 0;
    },
    _fn: /** @type {(s: any) => void} */ (() => {})
  };
  const router = { gotoView: vi.fn() };
  return { mount, store, router };
}

describe('views/nav', () => {
  test('renders and routes between tabs', async () => {
    const { mount, store, router } = setup();
    createTopNav(
      mount,
      /** @type {any} */ (store),
      /** @type {any} */ (router)
    );
    const links = mount.querySelectorAll('a.tab');
    expect(links.length).toBe(4);
    links[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(router.gotoView).toHaveBeenCalledWith('epics');
    links[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(router.gotoView).toHaveBeenCalledWith('board');
  });

  test('renders the Graph tab after Board and routes to it', () => {
    const { mount, store, router } = setup();
    createTopNav(
      mount,
      /** @type {any} */ (store),
      /** @type {any} */ (router)
    );
    const links = Array.from(mount.querySelectorAll('a.tab'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Issues',
      'Epics',
      'Board',
      'Graph'
    ]);
    const graph = links[3];
    expect(graph.getAttribute('href')).toBe('#/graph');
    graph.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(router.gotoView).toHaveBeenCalledWith('graph');
  });

  test('marks the Graph tab active on the graph view', () => {
    const { mount, store, router } = setup();
    store.set({ view: 'graph' });
    createTopNav(
      mount,
      /** @type {any} */ (store),
      /** @type {any} */ (router)
    );
    const active = mount.querySelectorAll('a.tab.active');
    expect(active.length).toBe(1);
    expect(active[0].textContent?.trim()).toBe('Graph');
  });
});
