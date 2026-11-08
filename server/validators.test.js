import { describe, expect, test } from 'vitest';
import { GRAPH_ISSUES_TYPE } from '../app/data/graph-subscription.js';
import { validateSubscribeListPayload } from './validators.js';

describe('validators', () => {
  describe('validateSubscribeListPayload', () => {
    test('accepts status-issues with valid params.status', () => {
      const result = validateSubscribeListPayload({
        id: 'test-1',
        type: 'status-issues',
        params: { status: 'in_review' }
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.spec.type).toBe('status-issues');
        expect(result.spec.params).toEqual({ status: 'in_review' });
      }
    });

    test('rejects status-issues without params', () => {
      const result = validateSubscribeListPayload({
        id: 'test-1',
        type: 'status-issues'
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('bad_request');
        expect(result.message).toMatch(
          /status-issues requires non-empty params\.status/
        );
      }
    });

    test('rejects status-issues with empty params.status', () => {
      const result = validateSubscribeListPayload({
        id: 'test-1',
        type: 'status-issues',
        params: { status: '' }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('bad_request');
        expect(result.message).toMatch(
          /status-issues requires non-empty params\.status/
        );
      }
    });

    test('rejects status-issues with whitespace-only params.status', () => {
      const result = validateSubscribeListPayload({
        id: 'test-1',
        type: 'status-issues',
        params: { status: '   ' }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('bad_request');
      }
    });

    test('trims params.status value', () => {
      const result = validateSubscribeListPayload({
        id: 'test-1',
        type: 'status-issues',
        params: { status: '  in_review  ' }
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.spec.params).toEqual({ status: 'in_review' });
      }
    });
    test('accepts graph-issues without params', () => {
      const result = validateSubscribeListPayload({
        id: 'test-graph',
        type: GRAPH_ISSUES_TYPE
      });
      expect(result).toEqual({
        ok: true,
        id: 'test-graph',
        spec: { type: GRAPH_ISSUES_TYPE, params: undefined }
      });
    });

    test('rejects graph-issues with params', () => {
      const result = validateSubscribeListPayload({
        id: 'test-graph',
        type: GRAPH_ISSUES_TYPE,
        params: { focus: 'UI-1' }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('bad_request');
        expect(result.message).toBe(
          `type ${GRAPH_ISSUES_TYPE} does not accept params`
        );
      }
    });

    test('lists graph-issues and status-issues among the known types', () => {
      const result = validateSubscribeListPayload({
        id: 'test-unknown',
        type: 'nope'
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain(GRAPH_ISSUES_TYPE);
        expect(result.message).toContain('status-issues');
      }
    });
  });
});
