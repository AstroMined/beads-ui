import { html } from 'lit-html';

// Shared multi-select filter dropdown used by the issues list and the board.

/**
 * @typedef {{ value: string, label: string }} FilterOption
 */

/**
 * @typedef {Object} FilterDropdownController
 * @property {(key: string) => boolean} isOpen - Whether the dropdown `key` is open.
 * @property {(key: string) => void} toggle - Open `key` (closing any other) or close it.
 * @property {() => void} close - Close whichever dropdown is open, returning
 * focus to its trigger when focus was inside it.
 * @property {() => void} dispose - Remove the document listeners.
 */

const ESCAPE_KEY = 'Escape';
const DEFAULT_ID_PREFIX = 'filter';

/**
 * Get display text for dropdown trigger.
 *
 * @param {string[]} selected
 * @param {string} label
 * @param {(val: string) => string} formatter
 * @returns {string}
 */
export function getDropdownDisplayText(selected, label, formatter) {
  if (selected.length === 0) return `${label}: Any`;
  if (selected.length === 1) return `${label}: ${formatter(selected[0])}`;
  return `${label} (${selected.length})`;
}

/**
 * Track which filter dropdown is open. At most one is open at a time; a click
 * outside the open dropdown or the Escape key closes it.
 *
 * @param {{ root?: Document | HTMLElement, onChange?: () => void }} [options]
 * `root` receives the click and keydown listeners (defaults to `document`).
 * `onChange` runs whenever the open dropdown changes, typically a re-render.
 * @returns {FilterDropdownController}
 */
export function createFilterDropdownController(options = {}) {
  const root = options.root || document;
  const on_change = options.onChange || (() => {});
  /** @type {string | null} */
  let open_key = null;

  /**
   * @param {string | null} next
   */
  function setOpen(next) {
    if (next === open_key) return;
    open_key = next;
    on_change();
  }

  /**
   * Close the open dropdown. When focus sits inside it, move focus back to its
   * trigger after the re-render so the hidden menu does not drop focus to body.
   */
  function closeRestoringFocus() {
    if (open_key === null) return;
    const doc =
      root.nodeType === Node.DOCUMENT_NODE
        ? /** @type {Document} */ (root)
        : root.ownerDocument || document;
    const active = doc.activeElement;
    const owner =
      active && typeof active.closest === 'function'
        ? active.closest('[data-filter]')
        : null;
    const key = open_key;
    const had_focus = Boolean(
      owner && owner.getAttribute('data-filter') === key
    );
    setOpen(null);
    if (!had_focus) return;
    const container = Array.from(doc.querySelectorAll('[data-filter]')).find(
      (el) => el.getAttribute('data-filter') === key
    );
    const trigger = /** @type {HTMLElement | null} */ (
      container ? container.querySelector('.filter-dropdown__trigger') : null
    );
    if (trigger) trigger.focus();
  }

  /**
   * @param {Event} ev
   */
  const onClick = (ev) => {
    if (open_key === null) return;
    const target = /** @type {Element | null} */ (ev.target);
    const owner =
      target && typeof target.closest === 'function'
        ? target.closest('[data-filter]')
        : null;
    if (owner && owner.getAttribute('data-filter') === open_key) return;
    setOpen(null);
  };

  /**
   * @param {Event} ev
   */
  const onKeydown = (ev) => {
    if (open_key === null) return;
    if (/** @type {KeyboardEvent} */ (ev).key !== ESCAPE_KEY) return;
    closeRestoringFocus();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);

  return {
    isOpen(key) {
      return open_key === key;
    },
    toggle(key) {
      setOpen(open_key === key ? null : key);
    },
    close() {
      closeRestoringFocus();
    },
    dispose() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeydown);
    }
  };
}

/**
 * Render a multi-select dropdown of checkboxes using the `filter-dropdown`
 * markup. The trigger stops click propagation so opening one dropdown is not
 * seen as a click outside by the controller.
 *
 * @param {Object} params
 * @param {string} params.key - Identifies the dropdown; rendered as `data-filter`.
 * @param {string} params.label - Trigger label, e.g. "Status".
 * @param {FilterOption[]} params.options - Checkbox options in display order.
 * @param {Set<string> | string[]} params.selected - Currently checked values.
 * @param {boolean} params.open - Whether the menu is shown.
 * @param {(key: string) => void} params.onToggle - Trigger click handler.
 * @param {(value: string, checked: boolean) => void} params.onChange - Checkbox change handler.
 * @param {string} [params.id_prefix] - Prefix for the menu id referenced by `aria-controls`.
 * @param {(value: string) => string} [params.formatter] - Formats a single
 * selected value in the trigger text; defaults to the option label.
 * @param {string} [params.display_text] - Overrides the trigger text entirely.
 * @returns {import('lit-html').TemplateResult}
 */
export function multiSelectDropdownTemplate({
  key,
  label,
  options,
  selected,
  open,
  onToggle,
  onChange,
  id_prefix = DEFAULT_ID_PREFIX,
  formatter,
  display_text
}) {
  const selected_list = Array.from(selected);
  const selected_set = new Set(selected_list);
  const menu_id = `${id_prefix}-${key}-menu`;
  /** @param {string} value */
  const optionLabel = (value) => {
    const found = options.find((o) => o.value === value);
    return found ? found.label : value;
  };
  const text =
    display_text !== undefined
      ? display_text
      : getDropdownDisplayText(selected_list, label, formatter || optionLabel);

  return html`
    <div class="filter-dropdown ${open ? 'is-open' : ''}" data-filter=${key}>
      <button
        type="button"
        class="filter-dropdown__trigger"
        aria-haspopup="true"
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${menu_id}
        @click=${(/** @type {Event} */ ev) => {
          ev.stopPropagation();
          onToggle(key);
        }}
      >
        ${text}
        <span class="filter-dropdown__arrow" aria-hidden="true">▾</span>
      </button>
      <div
        class="filter-dropdown__menu"
        id=${menu_id}
        role="group"
        aria-label=${label}
      >
        ${options.map(
          (opt) => html`
            <label class="filter-dropdown__option">
              <input
                type="checkbox"
                .checked=${selected_set.has(opt.value)}
                @change=${(/** @type {Event} */ ev) =>
                  onChange(
                    opt.value,
                    /** @type {HTMLInputElement} */ (ev.currentTarget).checked
                  )}
              />
              ${opt.label}
            </label>
          `
        )}
      </div>
    </div>
  `;
}
