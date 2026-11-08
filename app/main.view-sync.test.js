import { describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

// Mock WS client before importing the app
vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type
     */
    async send(type) {
      void type;
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

describe('initial view sync on reload (#/epics)', () => {
  test('shows Epics view when hash is #/epics', async () => {
    window.location.hash = '#/epics';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);

    // Allow any microtasks to flush
    await Promise.resolve();

    const issuesRoot = /** @type {HTMLElement} */ (
      document.getElementById('issues-root')
    );
    const epicsRoot = /** @type {HTMLElement} */ (
      document.getElementById('epics-root')
    );

    expect(issuesRoot.hidden).toBe(true);
    expect(epicsRoot.hidden).toBe(false);
  });

  test('shows only the Graph view when hash is #/graph?focus=<id>', async () => {
    window.location.hash = '#/graph?focus=UI-1';
    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));

    bootstrap(root);
    await Promise.resolve();

    /** @param {string} id */
    const hidden = (id) =>
      /** @type {HTMLElement} */ (document.getElementById(id)).hidden;
    expect(hidden('graph-root')).toBe(false);
    expect(hidden('issues-root')).toBe(true);
    expect(hidden('epics-root')).toBe(true);
    expect(hidden('board-root')).toBe(true);
    expect(hidden('settings-root')).toBe(true);
    expect(window.localStorage.getItem('beads-ui.view')).toBe('graph');
  });
});
