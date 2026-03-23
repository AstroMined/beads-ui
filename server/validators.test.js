import { describe, expect, test } from 'vitest';
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
        expect(result.message).toMatch(/status-issues requires non-empty params\.status/);
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
        expect(result.message).toMatch(/status-issues requires non-empty params\.status/);
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
  });
});
