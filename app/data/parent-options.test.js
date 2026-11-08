import { describe, expect, test } from 'vitest';
import { buildDepIndex } from './dep-graph.js';
import {
  compareIdsNatural,
  filterParentOptions,
  flattenParentOptions
} from './parent-options.js';

/**
 * @param {import('./parent-options.js').ParentOption[]} options
 */
function rows(options) {
  return options.map((o) => `${'  '.repeat(o.depth)}${o.id}`);
}

describe('data/parent-options', () => {
  test('compareIdsNatural orders numeric segments as numbers', () => {
    const ids = ['ui-1.10', 'ui-1.2', 'ui-1', 'ui-10', 'ui-2'];
    expect(ids.slice().sort(compareIdsNatural)).toEqual([
      'ui-1',
      'ui-1.2',
      'ui-1.10',
      'ui-2',
      'ui-10'
    ]);
  });

  test('lists the ancestors of the items in tree order with depth', () => {
    const index = buildDepIndex([
      { id: 'E', title: 'Epic', issue_type: 'epic' },
      { id: 'E.10', title: 'Ten', issue_type: 'feature', parent: 'E' },
      { id: 'E.2', title: 'Two', issue_type: 'feature', parent: 'E' },
      { id: 'E.2.1', title: 'Task', parent: 'E.2' },
      { id: 'E.10.1', title: 'Task', parent: 'E.10' },
      { id: 'F', title: 'Other' },
      { id: 'F.1', title: 'Leaf', parent: 'F' }
    ]);
    const options = flattenParentOptions(index, ['E.2.1', 'E.10.1', 'F.1']);
    expect(rows(options)).toEqual(['E', '  E.2', '  E.10', 'F']);
    expect(options[0]).toEqual({
      id: 'E',
      parent: null,
      depth: 0,
      title: 'Epic',
      issue_type: 'epic',
      status: 'open',
      known: true
    });
    expect(options[1].parent).toBe('E');
  });

  test('keeps a closed intermediate and marks an unknown root', () => {
    const index = buildDepIndex([
      { id: 'M', title: 'Middle', status: 'closed', parent: 'GONE' },
      { id: 'T', title: 'Task', parent: 'M' }
    ]);
    const options = flattenParentOptions(index, ['T']);
    expect(rows(options)).toEqual(['GONE', '  M']);
    expect(options[0].known).toBe(false);
    expect(options[0].title).toBe('');
    expect(options[1].status).toBe('closed');
  });

  test('an item that is also an ancestor is listed once', () => {
    const index = buildDepIndex([
      { id: 'E' },
      { id: 'E.1', parent: 'E' },
      { id: 'E.1.1', parent: 'E.1' }
    ]);
    const options = flattenParentOptions(index, ['E.1', 'E.1.1', 'E.1']);
    expect(rows(options)).toEqual(['E', '  E.1']);
  });

  test('a parent cycle is listed without dropping members', () => {
    const index = buildDepIndex([
      { id: 'A', parent: 'B' },
      { id: 'B', parent: 'A' },
      { id: 'X', parent: 'A' }
    ]);
    const options = flattenParentOptions(index, ['X']);
    expect(rows(options)).toEqual(['A', '  B']);
  });

  test('items without a parent produce no options', () => {
    const index = buildDepIndex([{ id: 'A' }, { id: 'B' }]);
    expect(flattenParentOptions(index, ['A', 'B'])).toEqual([]);
  });

  test('filterParentOptions keeps matches and their ancestors', () => {
    const index = buildDepIndex([
      { id: 'E', title: 'Epic' },
      { id: 'E.1', title: 'Login flow', parent: 'E' },
      { id: 'E.1.1', title: 'Leaf', parent: 'E.1' },
      { id: 'E.2', title: 'Billing', parent: 'E' },
      { id: 'E.2.1', title: 'Leaf', parent: 'E.2' }
    ]);
    const options = flattenParentOptions(index, ['E.1.1', 'E.2.1']);
    expect(rows(filterParentOptions(options, 'LOGIN'))).toEqual(['E', '  E.1']);
    expect(rows(filterParentOptions(options, 'e.2'))).toEqual(['E', '  E.2']);
    expect(filterParentOptions(options, 'nothing')).toEqual([]);
  });

  test('filterParentOptions with a blank query keeps every option', () => {
    const index = buildDepIndex([{ id: 'E' }, { id: 'E.1', parent: 'E' }]);
    const options = flattenParentOptions(index, ['E.1']);
    const kept = filterParentOptions(options, '   ');
    expect(kept).toEqual(options);
    expect(kept).not.toBe(options);
  });
});
