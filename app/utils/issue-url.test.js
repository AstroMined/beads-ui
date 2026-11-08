import { describe, expect, test } from 'vitest';
import { graphHashFor, issueHashFor, viewHashFor } from './issue-url.js';

describe('utils/issue-url', () => {
  test('viewHashFor builds a bare view hash without params', () => {
    expect(viewHashFor('issues')).toBe('#/issues');
    expect(viewHashFor('settings', {})).toBe('#/settings');
    expect(viewHashFor('graph', { focus: null, issue: null })).toBe('#/graph');
  });

  test('viewHashFor orders focus before issue', () => {
    expect(viewHashFor('graph', { issue: 'UI-2', focus: 'UI-1' })).toBe(
      '#/graph?focus=UI-1&issue=UI-2'
    );
  });

  test('viewHashFor drops the focus off the graph view', () => {
    expect(viewHashFor('board', { focus: 'UI-1', issue: 'UI-2' })).toBe(
      '#/board?issue=UI-2'
    );
    expect(viewHashFor('epics', { focus: 'UI-1' })).toBe('#/epics');
  });

  test('viewHashFor encodes param values', () => {
    expect(viewHashFor('graph', { focus: 'a b&c', issue: 'x/y' })).toBe(
      '#/graph?focus=a%20b%26c&issue=x%2Fy'
    );
  });

  test('graphHashFor builds focus and optional issue params', () => {
    expect(graphHashFor(null)).toBe('#/graph');
    expect(graphHashFor('UI-1')).toBe('#/graph?focus=UI-1');
    expect(graphHashFor('UI-1', 'UI-2')).toBe('#/graph?focus=UI-1&issue=UI-2');
    expect(graphHashFor(null, 'UI-2')).toBe('#/graph?issue=UI-2');
  });

  test('issueHashFor keeps whitelisted views and falls back to issues', () => {
    expect(issueHashFor('issues', 'UI-1')).toBe('#/issues?issue=UI-1');
    expect(issueHashFor('epics', 'UI-1')).toBe('#/epics?issue=UI-1');
    expect(issueHashFor('board', 'UI-1')).toBe('#/board?issue=UI-1');
    expect(issueHashFor('graph', 'UI-1')).toBe('#/graph?issue=UI-1');
    expect(issueHashFor('settings', 'UI-1')).toBe('#/issues?issue=UI-1');
  });
});
