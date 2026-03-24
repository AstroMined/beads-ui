import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createSettingsView } from './settings.js';

/**
 * Create a mock transport with send/on interface.
 *
 * @param {{ global_settings?: any, project_settings?: any }} [options]
 */
function createMockTransport(options = {}) {
  const global_settings = options.global_settings || {
    board: {
      columns: [
        {
          id: 'blocked',
          label: 'Blocked',
          subscription: 'blocked-issues',
          drop_status: 'open'
        },
        {
          id: 'ready',
          label: 'Ready',
          subscription: 'ready-issues',
          drop_status: 'open'
        }
      ]
    },
    discovery: {
      scan_roots: ['/home/user/projects'],
      scan_depth: 3
    }
  };
  const project_settings = options.project_settings || null;

  /** @type {Record<string, (p: any) => void>} */
  const handlers = {};

  /** @type {Array<{type: string, payload: any}>} */
  const sent = [];

  return {
    /** @type {(type: string, payload?: any) => Promise<any>} */
    async send(type, payload) {
      sent.push({ type, payload });
      if (type === 'get-settings') {
        return { settings: global_settings };
      }
      if (type === 'get-project-settings') {
        return { settings: project_settings };
      }
      if (type === 'save-settings') {
        return { settings: payload.settings };
      }
      return null;
    },
    /** @type {(type: string, handler: (p: any) => void) => () => void} */
    on(type, handler) {
      handlers[type] = handler;
      return () => {
        delete handlers[type];
      };
    },
    /**
     * Trigger a server push event.
     *
     * @param {string} type
     * @param {any} payload
     */
    _trigger(type, payload) {
      if (handlers[type]) {
        handlers[type](payload);
      }
    },
    /** Access sent messages for assertions. */
    get sent() {
      return sent;
    }
  };
}

function createMockStore() {
  return {
    getState: () => ({
      workspace: { current: { path: '/home/user/my-project' } }
    }),
    subscribe: () => () => {}
  };
}

/**
 * Get the currently visible tabpanel from the mount element.
 *
 * @param {HTMLElement} el
 * @returns {HTMLElement}
 */
function activePanel(el) {
  const panels = Array.from(el.querySelectorAll('[role="tabpanel"]'));
  for (const p of panels) {
    if (!(/** @type {HTMLElement} */ (p).hidden)) {
      return /** @type {HTMLElement} */ (p);
    }
  }
  return el;
}

describe('views/settings', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createMockStore>} */
  let store;

  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-mount"></div>';
    mount = /** @type {HTMLElement} */ (
      document.getElementById('settings-mount')
    );
    store = createMockStore();
  });

  describe('lifecycle', () => {
    test('load() renders tab bar with Global and Local tabs', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const tabs = mount.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(2);
      expect(tabs[0].textContent).toContain('Global');
      expect(tabs[1].textContent).toContain('Local');
    });

    test('clear() removes all content from mount element', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      expect(mount.children.length).toBeGreaterThan(0);
      view.clear();
      expect(mount.children.length).toBe(0);
    });

    test('switching tabs shows correct panel', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Global tab is active by default
      const panels = mount.querySelectorAll('[role="tabpanel"]');
      expect(panels.length).toBe(2);
      expect(/** @type {HTMLElement} */ (panels[0]).hidden).toBe(false);
      expect(/** @type {HTMLElement} */ (panels[1]).hidden).toBe(true);

      // Click Local tab
      const tabs = mount.querySelectorAll('[role="tab"]');
      /** @type {HTMLButtonElement} */ (tabs[1]).click();

      const panels2 = mount.querySelectorAll('[role="tabpanel"]');
      expect(/** @type {HTMLElement} */ (panels2[0]).hidden).toBe(true);
      expect(/** @type {HTMLElement} */ (panels2[1]).hidden).toBe(false);
    });
  });

  describe('column list', () => {
    test('Global tab renders column list from settings data', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const rows = activePanel(mount).querySelectorAll('.settings-column-row');
      expect(rows.length).toBe(2);
    });

    test('each row shows label, subscription, drop_status', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const rows = activePanel(mount).querySelectorAll('.settings-column-row');
      const first = rows[0];
      expect(first.querySelector('.settings-column-label')?.textContent).toBe(
        'Blocked'
      );
      expect(first.querySelector('.settings-column-sub')?.textContent).toBe(
        'blocked-issues'
      );
      expect(first.querySelector('.settings-column-status')?.textContent).toBe(
        'open'
      );
    });
  });

  describe('column add', () => {
    test('clicking Add Column shows the form', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      expect(mount.querySelector('.settings-column-form')).toBeNull();
      const addBtn = mount.querySelector('.settings-column-add');
      /** @type {HTMLButtonElement} */ (addBtn).click();
      expect(mount.querySelector('.settings-column-form')).not.toBeNull();
    });

    test('filling form and submitting adds column to list', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Open add form
      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();

      // Fill form
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'new-col';
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'New Column';

      // Submit
      /** @type {HTMLButtonElement} */ (
        form.querySelector('.settings-form-save')
      ).click();

      const rows = activePanel(mount).querySelectorAll('.settings-column-row');
      expect(rows.length).toBe(3);
    });

    test('cancel hides form without adding', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      expect(mount.querySelector('.settings-column-form')).not.toBeNull();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-form-cancel')
      ).click();
      expect(mount.querySelector('.settings-column-form')).toBeNull();

      const rows = activePanel(mount).querySelectorAll('.settings-column-row');
      expect(rows.length).toBe(2);
    });
  });

  describe('column edit', () => {
    test('clicking Edit populates form with column data', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const editBtns = mount.querySelectorAll('.settings-column-edit');
      /** @type {HTMLButtonElement} */ (editBtns[0]).click();

      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      expect(form).not.toBeNull();
      expect(
        /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value
      ).toBe('blocked');
      expect(
        /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).disabled
      ).toBe(true);
    });

    test('submitting edit updates the column in list', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const editBtns = mount.querySelectorAll('.settings-column-edit');
      /** @type {HTMLButtonElement} */ (editBtns[0]).click();

      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'Updated Label';
      /** @type {HTMLButtonElement} */ (
        form.querySelector('.settings-form-save')
      ).click();

      const firstLabel = mount.querySelector(
        '.settings-column-row .settings-column-label'
      );
      expect(firstLabel?.textContent).toBe('Updated Label');
    });
  });

  describe('column delete', () => {
    test('clicking Delete removes column from list', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      expect(
        activePanel(mount).querySelectorAll('.settings-column-row').length
      ).toBe(2);
      const delBtns = activePanel(mount).querySelectorAll(
        '.settings-column-delete'
      );
      /** @type {HTMLButtonElement} */ (delBtns[0]).click();
      expect(
        activePanel(mount).querySelectorAll('.settings-column-row').length
      ).toBe(1);
    });
  });

  describe('validation', () => {
    test('empty ID rejected with error message', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('Column ID is required');
    });

    test('invalid ID format rejected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'Bad-Name';
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'Test';
      /** @type {HTMLButtonElement} */ (
        form.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('kebab-case');
    });

    test('duplicate ID rejected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'blocked';
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'Duplicate';
      /** @type {HTMLButtonElement} */ (
        form.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('already exists');
    });

    test('empty label rejected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'valid-id';
      /** @type {HTMLButtonElement} */ (
        form.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('label is required');
    });

    test('missing status param for status-issues rejected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'status-col';
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'Status Col';
      /** @type {HTMLSelectElement} */ (
        form.querySelector('#col-subscription')
      ).value = 'status-issues';
      // Trigger change to show params field
      form
        ?.querySelector('#col-subscription')
        ?.dispatchEvent(new Event('change'));

      // Wait for re-render
      await vi.waitFor(() => {
        const saveBtn = mount.querySelector('.settings-form-save');
        expect(saveBtn).not.toBeNull();
      });

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('Status parameter is required');
    });

    test('missing issue ID param for issue-detail rejected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-column-add')
      ).click();
      const form = /** @type {HTMLElement} */ (
        mount.querySelector('.settings-column-form')
      );
      /** @type {HTMLInputElement} */ (form.querySelector('#col-id')).value =
        'detail-col';
      /** @type {HTMLInputElement} */ (form.querySelector('#col-label')).value =
        'Detail Col';
      /** @type {HTMLSelectElement} */ (
        form.querySelector('#col-subscription')
      ).value = 'issue-detail';
      form
        ?.querySelector('#col-subscription')
        ?.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        const saveBtn = mount.querySelector('.settings-form-save');
        expect(saveBtn).not.toBeNull();
      });

      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-form-save')
      ).click();

      const err = mount.querySelector('.settings-column-error');
      expect(err?.textContent).toContain('Issue ID parameter is required');
    });
  });

  describe('dirty detection', () => {
    test('deleting a column marks form as dirty (Save shows asterisk)', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Initially not dirty
      let saveBtn = mount.querySelector('.settings-save');
      expect(saveBtn?.textContent?.trim()).toBe('Save');

      // Delete a column
      const delBtns = activePanel(mount).querySelectorAll(
        '.settings-column-delete'
      );
      /** @type {HTMLButtonElement} */ (delBtns[0]).click();

      saveBtn = mount.querySelector('.settings-save');
      expect(saveBtn?.textContent).toContain('*');
    });

    test('reset clears dirty state', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Make dirty
      /** @type {HTMLButtonElement} */ (
        activePanel(mount).querySelector('.settings-column-delete')
      ).click();
      expect(mount.querySelector('.settings-save')?.textContent).toContain('*');

      // Reset
      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-reset')
      ).click();

      expect(mount.querySelector('.settings-save')?.textContent?.trim()).toBe(
        'Save'
      );
      expect(
        activePanel(mount).querySelectorAll('.settings-column-row').length
      ).toBe(2);
    });
  });

  describe('save', () => {
    test('global save dispatches save-settings with correct payload', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Delete a column to make dirty
      /** @type {HTMLButtonElement} */ (
        activePanel(mount).querySelector('.settings-column-delete')
      ).click();

      // Save
      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-save')
      ).click();

      // Wait for the async save
      await vi.waitFor(() => {
        const saveMsg = transport.sent.find((m) => m.type === 'save-settings');
        expect(saveMsg).toBeDefined();
      });

      const saveMsg = transport.sent.find((m) => m.type === 'save-settings');
      expect(saveMsg?.payload.scope).toBe('global');
      expect(saveMsg?.payload.settings.board.columns).toHaveLength(1);
      expect(saveMsg?.payload.settings.discovery).toBeDefined();
    });

    test('save disables button during request', async () => {
      const transport = createMockTransport();
      // Override send to be slow
      let resolvePromise = () => {};
      const originalSend = transport.send;
      transport.send = async (type, payload) => {
        if (type === 'save-settings') {
          return new Promise((resolve) => {
            resolvePromise = () => resolve({ settings: payload.settings });
          });
        }
        return originalSend(type, payload);
      };

      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Delete to make dirty
      /** @type {HTMLButtonElement} */ (
        activePanel(mount).querySelector('.settings-column-delete')
      ).click();

      // Click save
      /** @type {HTMLButtonElement} */ (
        mount.querySelector('.settings-save')
      ).click();

      // Button should be disabled during save
      await vi.waitFor(() => {
        const btn = /** @type {HTMLButtonElement} */ (
          mount.querySelector('.settings-save')
        );
        expect(btn.disabled).toBe(true);
      });

      // Resolve the promise
      resolvePromise();

      await vi.waitFor(() => {
        const btn = /** @type {HTMLButtonElement} */ (
          mount.querySelector('.settings-save')
        );
        expect(btn.disabled).toBe(false);
      });
    });
  });

  describe('local tab', () => {
    test('default shows Inherit global columns selected', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Switch to local tab
      const tabs = mount.querySelectorAll('[role="tab"]');
      /** @type {HTMLButtonElement} */ (tabs[1]).click();

      const inheritRadio = /** @type {HTMLInputElement} */ (
        mount.querySelector('input[value="inherit"]')
      );
      expect(inheritRadio.checked).toBe(true);
    });

    test('inherit mode shows read-only column list (no edit/delete buttons)', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Switch to local tab
      const tabs = mount.querySelectorAll('[role="tab"]');
      /** @type {HTMLButtonElement} */ (tabs[1]).click();

      // Should have columns from global but no edit/delete buttons
      const panel = activePanel(mount);
      const rows = panel.querySelectorAll('.settings-column-row');
      expect(rows.length).toBe(2);
      expect(panel.querySelector('.settings-column-edit')).toBeNull();
      expect(panel.querySelector('.settings-column-delete')).toBeNull();
    });

    test('override mode shows column editor with project columns', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Switch to local tab
      const tabs = mount.querySelectorAll('[role="tab"]');
      /** @type {HTMLButtonElement} */ (tabs[1]).click();

      // Switch to override
      const overrideRadio = /** @type {HTMLInputElement} */ (
        mount.querySelector('input[value="override"]')
      );
      overrideRadio.checked = true;
      overrideRadio.dispatchEvent(new Event('change'));

      // Should have editable columns
      await vi.waitFor(() => {
        expect(mount.querySelector('.settings-column-edit')).not.toBeNull();
      });
    });
  });

  describe('external changes', () => {
    test('settings-changed when clean silently updates display', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      expect(
        activePanel(mount).querySelectorAll('.settings-column-row').length
      ).toBe(2);

      // Trigger external change
      transport._trigger('settings-changed', {
        settings: {
          board: {
            columns: [
              {
                id: 'new-only',
                label: 'New Only',
                subscription: 'all-issues',
                drop_status: 'open'
              }
            ]
          }
        }
      });

      // Should update to 1 column silently
      const rows = activePanel(mount).querySelectorAll('.settings-column-row');
      expect(rows.length).toBe(1);
      expect(mount.querySelector('.settings-toast')).toBeNull();
    });

    test('settings-changed when dirty shows notification', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      // Make dirty by deleting a column
      /** @type {HTMLButtonElement} */ (
        activePanel(mount).querySelector('.settings-column-delete')
      ).click();

      // Trigger external change
      transport._trigger('settings-changed', {
        settings: {
          board: {
            columns: [
              {
                id: 'ext-col',
                label: 'External',
                subscription: 'all-issues',
                drop_status: 'open'
              }
            ]
          }
        }
      });

      const toast = mount.querySelector('.settings-toast');
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain('Settings changed externally');
    });
  });

  describe('discovery settings', () => {
    test('renders scan roots and scan depth', async () => {
      const transport = createMockTransport();
      const view = createSettingsView(mount, store, transport);
      await view.load();

      const roots = mount.querySelectorAll('.settings-discovery-root');
      expect(roots.length).toBe(1);
      expect(roots[0].querySelector('span')?.textContent).toBe(
        '/home/user/projects'
      );

      const depthInput = /** @type {HTMLInputElement} */ (
        mount.querySelector('#discovery-depth')
      );
      expect(depthInput.value).toBe('3');
    });
  });
});
