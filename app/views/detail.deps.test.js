import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDetailView } from './detail.js';

function setupDom() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

/**
 * A detail snapshot in the bd show shape.
 *
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   dependencies: Array<{ id: string, dependency_type: string }>,
 *   dependents: Array<{ id: string, dependency_type: string }>
 * }} DetailFixture
 */

/**
 * Issue stores that serve one detail snapshot.
 *
 * @param {DetailFixture} issue
 */
function storesFor(issue) {
  return {
    /** @param {string} id */
    snapshotFor(id) {
      return id === `detail:${issue.id}` ? [issue] : [];
    },
    subscribe() {
      return () => {};
    }
  };
}

/**
 * Load a detail view for the given issue and return its mount.
 *
 * @param {DetailFixture} issue
 */
async function mountDetail(issue) {
  const mount = setupDom();
  const send = vi.fn(async () => issue);
  const view = createDetailView(mount, send, undefined, storesFor(issue));
  await view.load(issue.id);
  return mount;
}

describe('views/detail dependencies', () => {
  test('adds Dependencies link and re-renders', async () => {
    const mount = setupDom();
    let current = { id: 'UI-10', title: 'X', dependencies: [], dependents: [] };
    const stores1 = {
      /** @param {string} id */
      snapshotFor(id) {
        return id === 'detail:UI-10' ? [current] : [];
      },
      subscribe() {
        return () => {};
      }
    };
    const send = vi.fn(async (type) => {
      if (type === 'dep-add') {
        return current;
      }
      throw new Error('Unexpected');
    });
    const view = createDetailView(mount, send, undefined, stores1);
    await view.load('UI-10');

    const input = mount.querySelector('[data-testid="add-dependency"]');
    expect(input).toBeTruthy();
    const el = /** @type {HTMLInputElement} */ (input);
    el.value = 'UI-2';
    const addBtn = el.nextElementSibling;
    addBtn?.dispatchEvent(new window.Event('click'));

    // Next tick
    await Promise.resolve();

    // Should have called dep-add
    const calls = send.mock.calls.map((c) => c[0]);
    expect(calls.includes('dep-add')).toBe(true);
  });

  test('removes Blocks link', async () => {
    const mount = setupDom();
    let current2 = {
      id: 'UI-20',
      title: 'Y',
      dependencies: [],
      dependents: [{ id: 'UI-5' }]
    };
    const stores2 = {
      /** @param {string} id */
      snapshotFor(id) {
        return id === 'detail:UI-20' ? [current2] : [];
      },
      subscribe() {
        return () => {};
      }
    };
    const send = vi.fn(async (type) => {
      if (type === 'dep-remove') {
        return { id: 'UI-20', dependencies: [], dependents: [] };
      }
      throw new Error('Unexpected');
    });
    const view = createDetailView(mount, send, undefined, stores2);
    await view.load('UI-20');

    // Find the remove button next to link #5
    const btns = mount.querySelectorAll('button');
    const rm = Array.from(btns).find((b) =>
      b.getAttribute('aria-label')?.includes('UI-5')
    );
    expect(rm).toBeTruthy();
    rm?.dispatchEvent(new window.Event('click'));

    await Promise.resolve();
    const calls = send.mock.calls.map((c) => c[0]);
    expect(calls.includes('dep-remove')).toBe(true);
  });

  test('prevents duplicate link add', async () => {
    const mount = setupDom();
    const current3 = {
      id: 'UI-30',
      dependencies: [{ id: 'UI-9' }],
      dependents: []
    };
    const stores3 = {
      /** @param {string} id */
      snapshotFor(id) {
        return id === 'detail:UI-30' ? [current3] : [];
      },
      subscribe() {
        return () => {};
      }
    };
    // eslint-disable-next-line no-unused-vars
    const send = vi.fn(async (type) => current3);
    const view = createDetailView(mount, send, undefined, stores3);
    await view.load('UI-30');

    const input = mount.querySelector('[data-testid="add-dependency"]');
    const el = /** @type {HTMLInputElement} */ (input);
    el.value = 'UI-9';
    const addBtn = el.nextElementSibling;
    addBtn?.dispatchEvent(new window.Event('click'));

    await Promise.resolve();
    // send should not be called with dep-add
    const calls = send.mock.calls.map((c) => c[0]);
    expect(calls.includes('dep-add')).toBe(false);
  });
});

describe('views/detail graph link', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  test('links to the graph focused on the issue when it blocks or is blocked', async () => {
    const mount = await mountDetail({
      id: 'UI-40',
      title: 'Blocked',
      dependencies: [{ id: 'UI-41', dependency_type: 'blocks' }],
      dependents: []
    });

    const link = mount.querySelector('[data-testid="view-in-graph"]');
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe('#/graph?focus=UI-40');
    expect(link?.textContent?.trim()).toBe('View in graph');
  });

  test('shows the link when only a dependent carries a blocks edge', async () => {
    const mount = await mountDetail({
      id: 'UI-50',
      dependencies: [],
      dependents: [{ id: 'UI-51', dependency_type: 'blocks' }]
    });

    const link = mount.querySelector('[data-testid="view-in-graph"]');
    expect(link?.getAttribute('href')).toBe('#/graph?focus=UI-50');
  });

  test('hides the link when relations are containment or context only', async () => {
    const mount = await mountDetail({
      id: 'UI-60',
      dependencies: [
        { id: 'UI-61', dependency_type: 'parent-child' },
        { id: 'UI-62', dependency_type: 'related' }
      ],
      dependents: [{ id: 'UI-63', dependency_type: 'parent-child' }]
    });

    expect(mount.querySelector('[data-testid="view-in-graph"]')).toBeNull();
    // The card itself still renders its title.
    const titles = Array.from(mount.querySelectorAll('.props-card__title')).map(
      (el) => el.textContent?.trim()
    );
    expect(titles).toContain('Dependencies');
  });

  test('dependency rows keep the graph focus while on the graph view', async () => {
    window.location.hash = '#/graph?focus=UI-1';
    const mount = await mountDetail({
      id: 'UI-70',
      dependencies: [{ id: 'UI-71', dependency_type: 'blocks' }],
      dependents: []
    });

    const row = mount.querySelector('li[data-href]');
    expect(row?.getAttribute('data-href')).toBe(
      '#/graph?focus=UI-1&issue=UI-71'
    );
  });

  test('dependency rows keep the plain view hash off the graph view', async () => {
    window.location.hash = '#/board';
    const mount = await mountDetail({
      id: 'UI-80',
      dependencies: [{ id: 'UI-81', dependency_type: 'blocks' }],
      dependents: []
    });

    const row = mount.querySelector('li[data-href]');
    expect(row?.getAttribute('data-href')).toBe('#/board?issue=UI-81');
  });
});
