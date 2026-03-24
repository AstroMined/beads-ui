import { html, render } from 'lit-html';
import { debug } from '../utils/logging.js';

/**
 * Create the Settings view with tabbed Global / Local layout.
 *
 * @param {HTMLElement} mount_element - Container to render into.
 * @param {{ getState: () => any, subscribe: (fn: (s: any) => void) => () => void }} store
 * @param {{ send: (type: string, payload?: unknown) => Promise<any>, on: (type: string, handler: (payload: any) => void) => () => void }} transport
 * @returns {{ load: () => Promise<void>, clear: () => void }}
 */
export function createSettingsView(mount_element, store, transport) {
  const log = debug('views:settings');

  /** @type {'global'|'local'} */
  let activeTab = 'global';

  /** @type {any} */
  let saved_global = null;
  /** @type {any} */
  let saved_project = null;

  /** @type {Array<{id: string, label: string, subscription: string, params?: Record<string, string>, drop_status: string}>} */
  let draft_columns = [];

  /** @type {{ scan_roots: string[], scan_depth: number }} */
  let draft_discovery = { scan_roots: [], scan_depth: 3 };

  /** @type {boolean} */
  let local_override = false;

  /** @type {Array<{id: string, label: string, subscription: string, params?: Record<string, string>, drop_status: string}>} */
  let draft_project_columns = [];

  /** @type {number|null} */
  let editing_index = null;

  /** @type {boolean} */
  let adding = false;

  /** @type {boolean} */
  let saving = false;

  /** @type {string} */
  let form_error = '';

  /** @type {string} */
  let notification = '';

  /** @type {(() => void)|null} */
  let unsub_settings_changed = null;

  /**
   * Deep clone a value via JSON round-trip.
   *
   * @param {any} val
   * @returns {any}
   */
  function deepClone(val) {
    return JSON.parse(JSON.stringify(val));
  }

  /**
   * Check whether the current draft state differs from saved state.
   *
   * @returns {boolean}
   */
  function isDirty() {
    if (activeTab === 'global') {
      const cols_dirty =
        JSON.stringify(draft_columns) !==
        JSON.stringify(saved_global?.board?.columns || []);
      const disc_dirty =
        JSON.stringify(draft_discovery) !==
        JSON.stringify({
          scan_roots: saved_global?.discovery?.scan_roots || [],
          scan_depth: saved_global?.discovery?.scan_depth ?? 3
        });
      return cols_dirty || disc_dirty;
    }
    // Local tab
    const saved_has_override =
      saved_project?.board?.columns && saved_project.board.columns.length > 0;
    if (local_override !== !!saved_has_override) {
      return true;
    }
    if (local_override) {
      return (
        JSON.stringify(draft_project_columns) !==
        JSON.stringify(saved_project?.board?.columns || [])
      );
    }
    return false;
  }

  /** Get the workspace display name. */
  function getWorkspaceName() {
    const s = store.getState();
    const path = s?.workspace?.current?.path || '';
    if (!path) return 'Local';
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : 'Local';
  }

  /**
   * Switch to a tab and re-render.
   *
   * @param {'global'|'local'} tab
   */
  function switchTab(tab) {
    activeTab = tab;
    editing_index = null;
    adding = false;
    form_error = '';
    notification = '';
    doRender();
  }

  /**
   * Delete a column from the active draft list.
   *
   * @param {number} index
   */
  function deleteColumn(index) {
    const cols = activeTab === 'global' ? draft_columns : draft_project_columns;
    cols.splice(index, 1);
    doRender();
  }

  /**
   * Open the edit form for a column.
   *
   * @param {number} index
   */
  function editColumn(index) {
    editing_index = index;
    adding = false;
    form_error = '';
    doRender();
  }

  /** Open the add form. */
  function addColumn() {
    adding = true;
    editing_index = null;
    form_error = '';
    doRender();
  }

  /** Reset form state and hide add/edit column form. */
  function cancelForm() {
    editing_index = null;
    adding = false;
    form_error = '';
    doRender();
  }

  /**
   * Move a column in the active draft by delta positions.
   *
   * @param {number} index
   * @param {number} delta - -1 for up, +1 for down
   */
  function moveColumn(index, delta) {
    const cols = activeTab === 'global' ? draft_columns : draft_project_columns;
    const target = index + delta;
    if (target < 0 || target >= cols.length) return;
    const temp = cols[index];
    cols[index] = cols[target];
    cols[target] = temp;
    doRender();
  }

  /**
   * Handle dragstart on a column row.
   *
   * @param {number} index
   * @param {DragEvent} ev
   */
  function onDragStart(index, ev) {
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(index));
    }
    const row = /** @type {HTMLElement} */ (ev.currentTarget);
    row.classList.add('is-dragging');
  }

  /**
   * Handle dragover on a column row.
   *
   * @param {DragEvent} ev
   */
  function onDragOver(ev) {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }
  }

  /**
   * Handle drop on a column row.
   *
   * @param {number} targetIndex
   * @param {DragEvent} ev
   */
  function onDrop(targetIndex, ev) {
    ev.preventDefault();
    const sourceStr = ev.dataTransfer?.getData('text/plain');
    const sourceIndex =
      sourceStr !== undefined && sourceStr !== null
        ? parseInt(sourceStr, 10)
        : NaN;
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;
    const cols = activeTab === 'global' ? draft_columns : draft_project_columns;
    const item = cols.splice(sourceIndex, 1)[0];
    cols.splice(targetIndex, 0, item);
    doRender();
  }

  /**
   * Handle dragend on a column row.
   *
   * @param {DragEvent} ev
   */
  function onDragEnd(ev) {
    const row = /** @type {HTMLElement} */ (ev.currentTarget);
    row.classList.remove('is-dragging');
  }

  // --- Subscription types and auto-suggest ---
  const SUBSCRIPTION_TYPES = [
    'all-issues',
    'epics',
    'blocked-issues',
    'ready-issues',
    'in-progress-issues',
    'closed-issues',
    'issue-detail',
    'status-issues'
  ];

  /** @type {Record<string, string>} */
  const AUTO_SUGGEST_DROP_STATUS = {
    'closed-issues': 'closed',
    'in-progress-issues': 'in_progress',
    'blocked-issues': 'open',
    'ready-issues': 'open',
    'status-issues': 'in_progress',
    'all-issues': 'open',
    epics: 'open',
    'issue-detail': 'open'
  };

  /**
   * Validate and save the column form.
   */
  function saveColumnForm() {
    const cols = activeTab === 'global' ? draft_columns : draft_project_columns;
    const form = mount_element.querySelector('.settings-column-form');
    if (!form) return;

    const id_input = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-id')
    );
    const label_input = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-label')
    );
    const sub_select = /** @type {HTMLSelectElement|null} */ (
      form.querySelector('#col-subscription')
    );
    const drop_select = /** @type {HTMLSelectElement|null} */ (
      form.querySelector('#col-drop-status')
    );
    const status_param = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-status-param')
    );
    const issue_param = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-issue-param')
    );

    const id = (id_input?.value || '').trim();
    const label = (label_input?.value || '').trim();
    const subscription = sub_select?.value || '';
    const drop_status = drop_select?.value || 'open';

    // Validate
    if (!id) {
      form_error = 'Column ID is required';
      doRender();
      return;
    }
    if (!/^[a-z][a-z0-9-_]*$/.test(id)) {
      form_error =
        'Column ID must be kebab-case (start with lowercase letter, use a-z, 0-9, -, _)';
      doRender();
      return;
    }
    // Check uniqueness (skip self when editing)
    const dup = cols.findIndex((c, i) => c.id === id && i !== editing_index);
    if (dup >= 0) {
      form_error = `Column ID "${id}" already exists`;
      doRender();
      return;
    }
    if (!label) {
      form_error = 'Column label is required';
      doRender();
      return;
    }
    if (subscription === 'status-issues') {
      const sv = (status_param?.value || '').trim();
      if (!sv) {
        form_error = 'Status parameter is required for status-issues columns';
        doRender();
        return;
      }
    }
    if (subscription === 'issue-detail') {
      const iv = (issue_param?.value || '').trim();
      if (!iv) {
        form_error = 'Issue ID parameter is required for issue-detail columns';
        doRender();
        return;
      }
    }

    /** @type {Record<string, string>|undefined} */
    let params;
    if (subscription === 'status-issues') {
      params = { status: (status_param?.value || '').trim() };
    } else if (subscription === 'issue-detail') {
      params = { id: (issue_param?.value || '').trim() };
    }

    const col_def = {
      id,
      label,
      subscription,
      drop_status,
      ...(params ? { params } : {})
    };
    if (editing_index !== null) {
      cols[editing_index] = col_def;
    } else {
      cols.push(col_def);
    }

    editing_index = null;
    adding = false;
    form_error = '';
    doRender();
  }

  /**
   * Render the column form template for add/edit.
   *
   * @param {{id: string, label: string, subscription: string, params?: Record<string, string>, drop_status: string}|null} column
   * @param {boolean} isEditing
   * @returns {import('lit-html').TemplateResult}
   */
  function columnFormTemplate(column, isEditing) {
    const sub = column?.subscription || 'all-issues';
    const showStatusParam = sub === 'status-issues';
    const showIssueParam = sub === 'issue-detail';
    return html`
      <div class="settings-column-form">
        <label for="col-id">ID</label>
        <input
          type="text"
          id="col-id"
          placeholder="my-column"
          .value=${column?.id || ''}
          ?disabled=${isEditing}
        />
        <label for="col-label">Label</label>
        <input
          type="text"
          id="col-label"
          placeholder="My Column"
          .value=${column?.label || ''}
        />
        <label for="col-subscription">Subscription</label>
        <select id="col-subscription" @change=${onSubscriptionChange}>
          ${SUBSCRIPTION_TYPES.map(
            (t) => html`<option value=${t} ?selected=${t === sub}>${t}</option>`
          )}
        </select>
        ${showStatusParam
          ? html`
              <label for="col-status-param">Status</label>
              <input
                type="text"
                id="col-status-param"
                placeholder="in_review"
                .value=${column?.params?.status || ''}
              />
            `
          : ''}
        ${showIssueParam
          ? html`
              <label for="col-issue-param">Issue ID</label>
              <input
                type="text"
                id="col-issue-param"
                placeholder="issue-id"
                .value=${column?.params?.id || ''}
              />
            `
          : ''}
        <label for="col-drop-status">Drop Status</label>
        <select id="col-drop-status">
          ${['open', 'in_progress', 'in_review', 'closed'].map(
            (s) =>
              html`<option
                value=${s}
                ?selected=${s ===
                (column?.drop_status ||
                  AUTO_SUGGEST_DROP_STATUS[sub] ||
                  'open')}
              >
                ${s}
              </option>`
          )}
        </select>
        <div class="settings-column-error" aria-live="polite" role="status">
          ${form_error}
        </div>
        <div class="settings-column-form-actions">
          <button class="settings-form-save" @click=${saveColumnForm}>
            ${isEditing ? 'Update Column' : 'Add Column'}
          </button>
          <button class="settings-form-cancel" @click=${cancelForm}>
            Cancel
          </button>
        </div>
      </div>
    `;
  }

  /** Handle subscription select change for auto-suggest. */
  function onSubscriptionChange() {
    const form = mount_element.querySelector('.settings-column-form');
    if (!form) return;
    const sub_select = /** @type {HTMLSelectElement|null} */ (
      form.querySelector('#col-subscription')
    );
    const drop_select = /** @type {HTMLSelectElement|null} */ (
      form.querySelector('#col-drop-status')
    );
    const sub = sub_select?.value || '';
    if (drop_select && AUTO_SUGGEST_DROP_STATUS[sub]) {
      drop_select.value = AUTO_SUGGEST_DROP_STATUS[sub];
    }
    // Re-render to show/hide conditional params
    // Preserve current form values before re-render
    const id_input = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-id')
    );
    const label_input = /** @type {HTMLInputElement|null} */ (
      form.querySelector('#col-label')
    );
    const tempCol = {
      id: id_input?.value || '',
      label: label_input?.value || '',
      subscription: sub,
      drop_status: drop_select?.value || 'open'
    };
    // Use a temporary render of just the form
    form_error = '';
    _temp_form_col = tempCol;
    doRender();
    _temp_form_col = null;
  }

  /** @type {{id: string, label: string, subscription: string, drop_status: string}|null} */
  let _temp_form_col = null;

  /**
   * Render column list template.
   *
   * @param {Array<{id: string, label: string, subscription: string, params?: Record<string, string>, drop_status: string}>} columns
   * @param {boolean} readonly
   * @returns {import('lit-html').TemplateResult}
   */
  function columnListTemplate(columns, readonly) {
    return html`
      <div class="settings-columns">
        ${columns.map(
          (col, i) => html`
            <div
              class="settings-column-row"
              draggable=${readonly ? 'false' : 'true'}
              data-index=${i}
              @dragstart=${readonly
                ? undefined
                : (/** @type {DragEvent} */ ev) => onDragStart(i, ev)}
              @dragover=${readonly ? undefined : onDragOver}
              @drop=${readonly
                ? undefined
                : (/** @type {DragEvent} */ ev) => onDrop(i, ev)}
              @dragend=${readonly ? undefined : onDragEnd}
            >
              ${readonly
                ? ''
                : html`<span
                    class="settings-drag-handle"
                    tabindex="0"
                    role="button"
                    aria-label="Reorder ${col.label}"
                    @keydown=${(/** @type {KeyboardEvent} */ ev) => {
                      if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        moveColumn(i, -1);
                      } else if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        moveColumn(i, 1);
                      }
                    }}
                    >&#10303;</span
                  >`}
              <span class="settings-column-label">${col.label}</span>
              <span class="settings-column-sub">${col.subscription}</span>
              <span class="settings-column-status">${col.drop_status}</span>
              ${readonly
                ? ''
                : html`
                    <div class="settings-column-actions">
                      <button
                        class="settings-column-edit"
                        @click=${() => editColumn(i)}
                      >
                        Edit
                      </button>
                      <button
                        class="settings-column-delete"
                        @click=${() => deleteColumn(i)}
                      >
                        Delete
                      </button>
                    </div>
                  `}
            </div>
            ${editing_index === i
              ? columnFormTemplate(_temp_form_col || columns[i], true)
              : ''}
          `
        )}
        ${readonly
          ? ''
          : html`<button class="settings-column-add" @click=${addColumn}>
              + Add Column
            </button>`}
        ${adding
          ? columnFormTemplate(
              _temp_form_col || {
                id: '',
                label: '',
                subscription: 'all-issues',
                drop_status: 'open'
              },
              false
            )
          : ''}
      </div>
    `;
  }

  /**
   * Render the discovery settings section.
   *
   * @returns {import('lit-html').TemplateResult}
   */
  function discoveryTemplate() {
    return html`
      <div class="settings-discovery">
        <h3>Discovery (global only)</h3>
        <div class="settings-discovery-roots">
          ${draft_discovery.scan_roots.map(
            (root, i) => html`
              <div class="settings-discovery-root">
                <span>${root}</span>
                <button
                  @click=${() => {
                    draft_discovery.scan_roots.splice(i, 1);
                    doRender();
                  }}
                >
                  &times;
                </button>
              </div>
            `
          )}
        </div>
        <div class="settings-discovery-add">
          <input
            type="text"
            id="discovery-root-input"
            placeholder="/path/to/scan"
          />
          <button
            @click=${() => {
              const input = /** @type {HTMLInputElement|null} */ (
                mount_element.querySelector('#discovery-root-input')
              );
              const val = (input?.value || '').trim();
              if (val && !draft_discovery.scan_roots.includes(val)) {
                draft_discovery.scan_roots.push(val);
                if (input) input.value = '';
                doRender();
              }
            }}
          >
            Add
          </button>
        </div>
        <div class="settings-discovery-depth">
          <label for="discovery-depth">Scan Depth</label>
          <input
            type="number"
            id="discovery-depth"
            min="1"
            .value=${String(draft_discovery.scan_depth)}
            @change=${(/** @type {Event} */ ev) => {
              const val = parseInt(
                /** @type {HTMLInputElement} */ (ev.target).value,
                10
              );
              if (!isNaN(val) && val >= 1) {
                draft_discovery.scan_depth = val;
              }
            }}
          />
        </div>
      </div>
    `;
  }

  /** Save current settings. */
  async function saveSettings() {
    if (saving) return;
    saving = true;
    form_error = '';
    doRender();

    try {
      if (activeTab === 'global') {
        const payload = {
          scope: 'global',
          settings: {
            board: { columns: draft_columns },
            discovery: draft_discovery
          }
        };
        const result = await transport.send('save-settings', payload);
        log('save-settings global result: %o', result);
        if (result?.settings) {
          saved_global = deepClone(result.settings);
          draft_columns = deepClone(result.settings.board?.columns || []);
          draft_discovery = {
            scan_roots: deepClone(result.settings.discovery?.scan_roots || []),
            scan_depth: result.settings.discovery?.scan_depth ?? 3
          };
        }
      } else {
        /** @type {any} */
        let settings;
        if (local_override) {
          settings = { board: { columns: draft_project_columns } };
        } else {
          settings = { board: {} };
        }
        const payload = { scope: 'project', settings };
        const result = await transport.send('save-settings', payload);
        log('save-settings project result: %o', result);
        if (result?.settings) {
          saved_project = deepClone(result.settings);
          if (result.settings.board?.columns?.length > 0) {
            local_override = true;
            draft_project_columns = deepClone(result.settings.board.columns);
          } else {
            local_override = false;
            draft_project_columns = [];
          }
        }
      }
    } catch (err) {
      log('save-settings error: %o', err);
      form_error =
        'Failed to save settings: ' +
        (err && typeof err === 'object' && 'message' in err
          ? /** @type {Error} */ (err).message
          : String(err));
    } finally {
      saving = false;
      doRender();
    }
  }

  /** Reset to saved state. */
  function resetSettings() {
    if (activeTab === 'global') {
      draft_columns = deepClone(saved_global?.board?.columns || []);
      draft_discovery = {
        scan_roots: deepClone(saved_global?.discovery?.scan_roots || []),
        scan_depth: saved_global?.discovery?.scan_depth ?? 3
      };
    } else {
      const has_override =
        saved_project?.board?.columns && saved_project.board.columns.length > 0;
      local_override = !!has_override;
      draft_project_columns = has_override
        ? deepClone(saved_project.board.columns)
        : [];
    }
    editing_index = null;
    adding = false;
    form_error = '';
    notification = '';
    doRender();
  }

  /**
   * Handle external settings-changed events.
   *
   * @param {any} payload
   */
  function handleSettingsChanged(payload) {
    const p = /** @type {any} */ (payload);
    if (!p?.settings) return;
    log('settings-changed in settings view: %o', p);

    if (isDirty()) {
      notification =
        'Settings changed externally. Save to keep your changes or Reset to load the new settings.';
      doRender();
    } else {
      // Silently update
      if (p.settings.board?.columns) {
        saved_global = deepClone(p.settings);
        draft_columns = deepClone(p.settings.board.columns);
      }
      if (p.settings.discovery) {
        draft_discovery = {
          scan_roots: deepClone(p.settings.discovery.scan_roots || []),
          scan_depth: p.settings.discovery.scan_depth ?? 3
        };
      }
      doRender();
    }
  }

  function doRender() {
    const dirty = isDirty();
    const workspaceName = getWorkspaceName();

    const tpl = html`
      <div class="settings-root">
        <h2 class="settings-heading">Settings</h2>
        ${notification
          ? html`<div class="settings-toast" aria-live="polite">
              ${notification}
            </div>`
          : ''}
        <div class="settings-tabs" role="tablist">
          <button
            role="tab"
            class="settings-tab"
            aria-selected=${activeTab === 'global'}
            @click=${() => switchTab('global')}
          >
            Global
          </button>
          <button
            role="tab"
            class="settings-tab"
            aria-selected=${activeTab === 'local'}
            @click=${() => switchTab('local')}
          >
            Local (${workspaceName})
          </button>
        </div>

        <div
          role="tabpanel"
          class="settings-tabpanel"
          ?hidden=${activeTab !== 'global'}
        >
          ${columnListTemplate(draft_columns, false)} ${discoveryTemplate()}
        </div>

        <div
          role="tabpanel"
          class="settings-tabpanel"
          ?hidden=${activeTab !== 'local'}
        >
          <div class="settings-local-mode">
            <label>
              <input
                type="radio"
                name="local-mode"
                value="inherit"
                ?checked=${!local_override}
                @change=${() => {
                  local_override = false;
                  doRender();
                }}
              />
              Inherit global columns
            </label>
            <label>
              <input
                type="radio"
                name="local-mode"
                value="override"
                ?checked=${local_override}
                @change=${() => {
                  local_override = true;
                  if (
                    draft_project_columns.length === 0 &&
                    saved_global?.board?.columns
                  ) {
                    draft_project_columns = deepClone(
                      saved_global.board.columns
                    );
                  }
                  doRender();
                }}
              />
              Override with custom columns
            </label>
          </div>
          ${local_override
            ? columnListTemplate(draft_project_columns, false)
            : columnListTemplate(draft_columns, true)}
        </div>

        <div class="settings-actions">
          <button
            class="settings-save"
            ?disabled=${saving}
            @click=${saveSettings}
          >
            ${saving ? 'Saving...' : dirty ? 'Save *' : 'Save'}
          </button>
          <button class="settings-reset" @click=${resetSettings}>Reset</button>
        </div>
        ${form_error && !adding && editing_index === null
          ? html`<div
              class="settings-column-error"
              aria-live="polite"
              role="status"
            >
              ${form_error}
            </div>`
          : ''}
      </div>
    `;
    render(tpl, mount_element);
  }

  return {
    async load() {
      log('settings load()');
      try {
        const [globalResult, projectResult] = await Promise.all([
          transport.send('get-settings', {}),
          transport
            .send('get-project-settings', {})
            .catch(() => ({ settings: null }))
        ]);

        saved_global = globalResult?.settings
          ? deepClone(globalResult.settings)
          : {
              board: { columns: [] },
              discovery: { scan_roots: [], scan_depth: 3 }
            };
        saved_project = projectResult?.settings
          ? deepClone(projectResult.settings)
          : null;

        draft_columns = deepClone(saved_global.board?.columns || []);
        draft_discovery = {
          scan_roots: deepClone(saved_global.discovery?.scan_roots || []),
          scan_depth: saved_global.discovery?.scan_depth ?? 3
        };

        const has_override =
          saved_project?.board?.columns &&
          saved_project.board.columns.length > 0;
        local_override = !!has_override;
        draft_project_columns = has_override
          ? deepClone(saved_project.board.columns)
          : [];

        // Reset form state
        activeTab = 'global';
        editing_index = null;
        adding = false;
        form_error = '';
        notification = '';

        // Listen for external changes
        if (unsub_settings_changed) {
          unsub_settings_changed();
        }
        unsub_settings_changed = transport.on(
          'settings-changed',
          handleSettingsChanged
        );

        doRender();
      } catch (err) {
        log('settings load error: %o', err);
        form_error = 'Failed to load settings';
        doRender();
      }
    },
    clear() {
      mount_element.replaceChildren();
      saved_global = null;
      saved_project = null;
      draft_columns = [];
      draft_discovery = { scan_roots: [], scan_depth: 3 };
      draft_project_columns = [];
      editing_index = null;
      adding = false;
      form_error = '';
      notification = '';
      if (unsub_settings_changed) {
        unsub_settings_changed();
        unsub_settings_changed = null;
      }
    }
  };
}
