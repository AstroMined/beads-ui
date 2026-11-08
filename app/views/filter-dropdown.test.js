import { render } from 'lit-html';
import { describe, expect, test, vi } from 'vitest';
import {
  createFilterDropdownController,
  getDropdownDisplayText,
  multiSelectDropdownTemplate
} from './filter-dropdown.js';

const OPTIONS = [
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' }
];

/**
 * Render two dropdowns ("a" and "b") wired to one controller.
 *
 * @param {{ selected?: string[], onChange?: (value: string, checked: boolean) => void }} [opts]
 */
function setup(opts = {}) {
  document.body.innerHTML = '<div id="m"></div><p id="outside">x</p>';
  const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
  const on_change = opts.onChange || (() => {});
  const doRender = () => {
    render(
      ['a', 'b'].map((key) =>
        multiSelectDropdownTemplate({
          key,
          label: key.toUpperCase(),
          options: OPTIONS,
          selected: opts.selected || [],
          open: controller.isOpen(key),
          onToggle: controller.toggle,
          onChange: on_change,
          id_prefix: 'test'
        })
      ),
      mount
    );
  };
  const controller = createFilterDropdownController({ onChange: doRender });
  doRender();
  /** @param {string} key */
  const dropdown = (key) =>
    /** @type {HTMLElement} */ (
      mount.querySelector(`.filter-dropdown[data-filter="${key}"]`)
    );
  /** @param {string} key */
  const trigger = (key) =>
    /** @type {HTMLButtonElement} */ (
      dropdown(key).querySelector('.filter-dropdown__trigger')
    );
  return { mount, controller, dropdown, trigger };
}

describe('views/filter-dropdown', () => {
  test('getDropdownDisplayText summarizes the selection', () => {
    const fmt = (/** @type {string} */ v) => v.toUpperCase();
    expect(getDropdownDisplayText([], 'Types', fmt)).toBe('Types: Any');
    expect(getDropdownDisplayText(['bug'], 'Types', fmt)).toBe('Types: BUG');
    expect(getDropdownDisplayText(['bug', 'task'], 'Types', fmt)).toBe(
      'Types (2)'
    );
  });

  test('keeps one dropdown open at a time', () => {
    const { controller, dropdown, trigger } = setup();
    trigger('a').click();
    expect(controller.isOpen('a')).toBe(true);
    expect(dropdown('a').classList.contains('is-open')).toBe(true);

    trigger('b').click();
    expect(controller.isOpen('a')).toBe(false);
    expect(controller.isOpen('b')).toBe(true);
    expect(dropdown('a').classList.contains('is-open')).toBe(false);
    expect(dropdown('b').classList.contains('is-open')).toBe(true);

    trigger('b').click();
    expect(controller.isOpen('b')).toBe(false);
    controller.dispose();
  });

  test('closes on click outside but not on click inside the open menu', () => {
    const on_change = vi.fn();
    const { controller, dropdown, trigger } = setup({ onChange: on_change });
    trigger('a').click();

    const checkbox = /** @type {HTMLInputElement} */ (
      dropdown('a').querySelector('input[type="checkbox"]')
    );
    checkbox.click();
    expect(on_change).toHaveBeenCalledWith('bug', true);
    expect(controller.isOpen('a')).toBe(true);

    /** @type {HTMLElement} */ (document.getElementById('outside')).click();
    expect(controller.isOpen('a')).toBe(false);
    expect(dropdown('a').classList.contains('is-open')).toBe(false);
    controller.dispose();
  });

  test('closes on Escape', () => {
    const { controller, dropdown, trigger } = setup();
    trigger('a').click();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(controller.isOpen('a')).toBe(true);

    trigger('a').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(controller.isOpen('a')).toBe(false);
    expect(dropdown('a').classList.contains('is-open')).toBe(false);
    controller.dispose();
  });

  test('close() and toggle() notify onChange only when state changes', () => {
    const on_change = vi.fn();
    const controller = createFilterDropdownController({ onChange: on_change });
    controller.close();
    expect(on_change).not.toHaveBeenCalled();
    controller.toggle('a');
    controller.close();
    expect(on_change).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  test('dispose removes the document listeners', () => {
    const add_spy = vi.spyOn(document, 'addEventListener');
    const remove_spy = vi.spyOn(document, 'removeEventListener');
    const { controller, trigger } = setup();
    const added = add_spy.mock.calls.map((c) => [c[0], c[1]]);
    expect(added.map((c) => c[0]).sort()).toEqual(['click', 'keydown']);

    controller.dispose();
    const removed = remove_spy.mock.calls.map((c) => [c[0], c[1]]);
    expect(removed).toEqual(expect.arrayContaining(added));

    trigger('a').click();
    expect(controller.isOpen('a')).toBe(true);
    /** @type {HTMLElement} */ (document.getElementById('outside')).click();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(controller.isOpen('a')).toBe(true);
    add_spy.mockRestore();
    remove_spy.mockRestore();
  });

  test('listens on a custom root instead of document', () => {
    document.body.innerHTML = '<div id="r"></div><p id="outside">x</p>';
    const root = /** @type {HTMLElement} */ (document.getElementById('r'));
    const controller = createFilterDropdownController({ root });
    controller.toggle('a');
    /** @type {HTMLElement} */ (document.getElementById('outside')).click();
    expect(controller.isOpen('a')).toBe(true);
    root.click();
    expect(controller.isOpen('a')).toBe(false);
    controller.dispose();
  });

  test('renders ARIA attributes and data-filter', () => {
    const { controller, dropdown, trigger } = setup();
    const btn = trigger('a');
    expect(dropdown('a').getAttribute('data-filter')).toBe('a');
    expect(btn.getAttribute('aria-haspopup')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('test-a-menu');
    const menu = /** @type {HTMLElement} */ (
      dropdown('a').querySelector('.filter-dropdown__menu')
    );
    expect(menu.id).toBe('test-a-menu');

    btn.click();
    expect(trigger('a').getAttribute('aria-expanded')).toBe('true');
    expect(trigger('b').getAttribute('aria-expanded')).toBe('false');
    controller.dispose();
  });

  test('trigger text uses option labels, formatter or display_text', () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    /** @param {Partial<Parameters<typeof multiSelectDropdownTemplate>[0]>} extra */
    const textFor = (extra) => {
      render(
        multiSelectDropdownTemplate({
          key: 'types',
          label: 'Types',
          options: OPTIONS,
          selected: new Set(['task']),
          open: false,
          onToggle: () => {},
          onChange: () => {},
          ...extra
        }),
        mount
      );
      const btn = /** @type {HTMLElement} */ (
        mount.querySelector('.filter-dropdown__trigger')
      );
      return (btn.textContent || '').replace('▾', '').trim();
    };
    expect(textFor({})).toBe('Types: Task');
    expect(textFor({ formatter: (v) => `<${v}>` })).toBe('Types: <task>');
    expect(textFor({ display_text: 'Columns 3/5' })).toBe('Columns 3/5');
    const checked = Array.from(
      mount.querySelectorAll('input[type="checkbox"]')
    ).map((el) => /** @type {HTMLInputElement} */ (el).checked);
    expect(checked).toEqual([false, true]);
    expect(
      /** @type {HTMLElement} */ (mount.querySelector('.filter-dropdown__menu'))
        .id
    ).toBe('filter-types-menu');
  });
});
