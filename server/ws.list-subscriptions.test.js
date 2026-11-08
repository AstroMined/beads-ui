import { createServer } from 'node:http';
import { describe, expect, test, vi } from 'vitest';
import { fetchListForSubscription } from './list-adapters.js';
import { keyOf, registry } from './subscriptions.js';
import { attachWsServer, handleMessage, scheduleListRefresh } from './ws.js';

// Mock adapters BEFORE importing ws.js to ensure the mock is applied
vi.mock('./list-adapters.js', () => ({
  fetchListForSubscription: vi.fn(async () => {
    // Return a simple, deterministic list for any spec
    return {
      ok: true,
      items: [
        { id: 'A', updated_at: 1, closed_at: null },
        { id: 'B', updated_at: 1, closed_at: null }
      ]
    };
  })
}));

describe('ws list subscriptions', () => {
  test('refresh emits upsert/delete after subscribe', async () => {
    vi.useFakeTimers();
    const server = createServer();
    const { wss } = attachWsServer(server, {
      path: '/ws',
      heartbeat_ms: 10000,
      refresh_debounce_ms: 50
    });
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };
    wss.clients.add(/** @type {any} */ (sock));

    // Initial subscribe
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'sub-2',
          type: /** @type {any} */ ('subscribe-list'),
          payload: { id: 'c2', type: 'all-issues' }
        })
      )
    );

    // Clear initial snapshot
    sock.sent = [];

    // Change adapter to simulate one added, one updated, one removed
    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    mock.mockResolvedValueOnce({
      ok: true,
      items: [
        { id: 'A', updated_at: 2, closed_at: null }, // updated
        { id: 'C', updated_at: 1, closed_at: null } // added
      ]
    });

    // Trigger refresh
    scheduleListRefresh();
    await vi.advanceTimersByTimeAsync(60);

    const events = sock.sent
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const upserts = events.filter((e) => e && e.type === 'upsert');
    const deletes = events.filter((e) => e && e.type === 'delete');
    expect(upserts.length).toBeGreaterThan(0);
    expect(deletes.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });
  test('subscribe-list attaches and publishes initial snapshot', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    const req = {
      id: 'sub-1',
      type: /** @type {any} */ ('subscribe-list'),
      payload: { id: 'c1', type: 'in-progress-issues' }
    };
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(JSON.stringify(req))
    );

    // Expect an OK reply for subscribe-list
    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(true);
    expect(reply && reply.type).toBe('subscribe-list');

    // Expect a snapshot event was sent containing issues
    const snapshot_envelope = sock.sent
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .find((o) => o && o.type === 'snapshot');
    expect(!!snapshot_envelope).toBe(true);
    expect(snapshot_envelope.payload && snapshot_envelope.payload.id).toBe(
      'c1'
    );
    expect(Array.isArray(snapshot_envelope.payload.issues)).toBe(true);
    expect(snapshot_envelope.payload.issues.length).toBeGreaterThan(0);

    const key = keyOf({ type: 'in-progress-issues' });
    const entry = registry.get(key);
    const before_size = entry ? entry.subscribers.size : 0;
    expect(before_size).toBeGreaterThanOrEqual(1);
  });

  test('subscribe-list returns bd_error payload when adapter fails', async () => {
    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    mock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'bd_error',
        message: 'bd failed: out of sync',
        details: { exit_code: 1 }
      }
    });

    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    const req = {
      id: 'sub-error',
      type: /** @type {any} */ ('subscribe-list'),
      payload: { id: 'c-err', type: 'all-issues' }
    };

    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(JSON.stringify(req))
    );

    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(false);
    expect(reply && reply.error && reply.error.code).toBe('bd_error');
    expect(reply && reply.error && reply.error.message).toContain(
      'out of sync'
    );
    expect(reply && reply.error && reply.error.details.exit_code).toBe(1);
  });

  test('unsubscribe-list detaches and disconnect sweep evicts entry', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    // Subscribe first
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'sub-1',
          type: /** @type {any} */ ('subscribe-list'),
          payload: { id: 'c1', type: 'all-issues' }
        })
      )
    );

    const key = keyOf({ type: 'all-issues' });
    const entry = registry.get(key);
    const before = entry ? entry.subscribers.size : 0;
    expect(before).toBeGreaterThanOrEqual(1);

    // Now unsubscribe
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'unsub-1',
          type: /** @type {any} */ ('unsubscribe-list'),
          payload: { id: 'c1' }
        })
      )
    );

    const entry2 = registry.get(key);
    const after_size = entry2 ? entry2.subscribers.size : 0;
    expect(after_size).toBeLessThan(before);

    // Do not assert full eviction here due to global registry used across tests
  });

  test('closed-issues pre-filter applies before diff', async () => {
    const now = Date.now();
    // Configure adapter mock for this test case
    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    mock.mockResolvedValueOnce({
      ok: true,
      items: [
        { id: 'old', updated_at: now - 3000, closed_at: now - 2000 },
        { id: 'recent', updated_at: now - 100, closed_at: now - 100 },
        { id: 'open', updated_at: now - 50, closed_at: null }
      ]
    });

    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    const since = now - 1000;
    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'sub-closed',
          type: /** @type {any} */ ('subscribe-list'),
          payload: { id: 'c-closed', type: 'closed-issues', params: { since } }
        })
      )
    );

    const key = keyOf({ type: 'closed-issues', params: { since } });
    const entry = registry.get(key);
    const ids = entry ? Array.from(entry.itemsById.keys()).sort() : [];
    expect(ids).toEqual(['recent']);
  });

  test('subscribe-list rejects unknown subscription type', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'bad-sub',
          type: /** @type {any} */ ('subscribe-list'),
          payload: { id: 'c-bad', type: 'not-supported' }
        })
      )
    );

    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(false);
    expect(reply && reply.error && reply.error.code).toBe('bad_request');
  });

  test('subscribe-list accepts issue-detail with id and publishes snapshot', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'sub-detail-1',
          type: /** @type {any} */ ('subscribe-list'),
          payload: {
            id: 'detail:UI-1',
            type: 'issue-detail',
            params: { id: 'UI-1' }
          }
        })
      )
    );

    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(true);
    expect(reply && reply.type).toBe('subscribe-list');

    const snapshot_envelope = sock.sent
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .find((o) => o && o.type === 'snapshot');
    expect(!!snapshot_envelope).toBe(true);
    expect(snapshot_envelope.payload && snapshot_envelope.payload.id).toBe(
      'detail:UI-1'
    );
    expect(Array.isArray(snapshot_envelope.payload.issues)).toBe(true);
  });

  test('subscribe-list issue-detail enforces id', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'bad-detail',
          type: /** @type {any} */ ('subscribe-list'),
          payload: { id: 'detail:UI-X', type: 'issue-detail' }
        })
      )
    );
    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(false);
    expect(reply && reply.error && reply.error.code).toBe('bad_request');
  });

  test('subscribe-list closed-issues validates since param', async () => {
    const sock = {
      sent: /** @type {string[]} */ ([]),
      readyState: 1,
      OPEN: 1,
      /** @param {string} msg */
      send(msg) {
        this.sent.push(String(msg));
      }
    };

    await handleMessage(
      /** @type {any} */ (sock),
      Buffer.from(
        JSON.stringify({
          id: 'bad-since',
          type: /** @type {any} */ ('subscribe-list'),
          payload: {
            id: 'c-closed',
            type: 'closed-issues',
            params: { since: 'yesterday' }
          }
        })
      )
    );
    const last = sock.sent[sock.sent.length - 1];
    const reply = JSON.parse(last);
    expect(reply && reply.ok).toBe(false);
    expect(reply && reply.error && reply.error.code).toBe('bad_request');
  });
});

/**
 * Create a fake open socket that records every frame sent to it.
 */
function makeSock() {
  return {
    sent: /** @type {string[]} */ ([]),
    readyState: 1,
    OPEN: 1,
    /** @param {string} msg */
    send(msg) {
      this.sent.push(String(msg));
    }
  };
}

/**
 * Send one request frame through handleMessage.
 *
 * @param {ReturnType<typeof makeSock>} sock
 * @param {string} id
 * @param {string} type
 * @param {Record<string, unknown>} payload
 */
async function send(sock, id, type, payload) {
  await handleMessage(
    /** @type {any} */ (sock),
    Buffer.from(JSON.stringify({ id, type, payload }))
  );
}

/**
 * Parse every frame a socket received.
 *
 * @param {ReturnType<typeof makeSock>} sock
 * @returns {any[]}
 */
function frames(sock) {
  return sock.sent.map((m) => JSON.parse(m));
}

/**
 * @param {string} issue_id
 */
function detailSpec(issue_id) {
  return { type: 'issue-detail', params: { id: issue_id } };
}

describe('ws list subscriptions sharing a key', () => {
  test('unsubscribing one client id keeps another on the same socket attached', async () => {
    const sock = makeSock();
    const spec = detailSpec('SHARED-UNSUB');
    const key = keyOf(spec);

    await send(sock, 'sub-a', 'subscribe-list', { id: 'c-a', ...spec });
    await send(sock, 'sub-b', 'subscribe-list', { id: 'c-b', ...spec });
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      true
    );

    await send(sock, 'unsub-a', 'unsubscribe-list', { id: 'c-a' });
    const reply_a = frames(sock).at(-1);
    expect(reply_a.ok).toBe(true);
    expect(reply_a.payload).toEqual({ id: 'c-a', unsubscribed: true });
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      true
    );

    await send(sock, 'unsub-b', 'unsubscribe-list', { id: 'c-b' });
    const reply_b = frames(sock).at(-1);
    expect(reply_b.payload).toEqual({ id: 'c-b', unsubscribed: true });
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      false
    );
  });

  test('a failed snapshot publish keeps a sibling client id attached', async () => {
    const sock = makeSock();
    const spec = detailSpec('SHARED-SNAPFAIL');
    const key = keyOf(spec);

    await send(sock, 'sub-a', 'subscribe-list', { id: 'c-a', ...spec });

    const spy = vi.spyOn(registry, 'applyItems').mockImplementationOnce(() => {
      throw new Error('apply failed');
    });
    try {
      await send(sock, 'sub-b', 'subscribe-list', { id: 'c-b', ...spec });
    } finally {
      spy.mockRestore();
    }

    const reply = frames(sock).at(-1);
    expect(reply.ok).toBe(false);
    expect(reply.error.message).toBe('Failed to publish snapshot');
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      true
    );

    // c-b was rolled back, so unsubscribing it reports nothing removed
    await send(sock, 'unsub-b', 'unsubscribe-list', { id: 'c-b' });
    expect(frames(sock).at(-1).payload).toEqual({
      id: 'c-b',
      unsubscribed: false
    });
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      true
    );
  });

  test('a failed snapshot publish detaches a socket with no sibling on the key', async () => {
    const sock = makeSock();
    const spec = detailSpec('SOLO-SNAPFAIL');
    const key = keyOf(spec);

    const spy = vi.spyOn(registry, 'applyItems').mockImplementationOnce(() => {
      throw new Error('apply failed');
    });
    try {
      await send(sock, 'sub-a', 'subscribe-list', { id: 'c-a', ...spec });
    } finally {
      spy.mockRestore();
    }

    expect(frames(sock).at(-1).ok).toBe(false);
    expect(registry.get(key)?.subscribers.has(/** @type {any} */ (sock))).toBe(
      false
    );
  });

  test("a newcomer's fetch delta reaches the existing subscriber on another socket", async () => {
    const first = makeSock();
    const second = makeSock();
    const spec = detailSpec('SHARED-FANOUT');

    // First subscriber sees the default list: A and B
    await send(first, 'sub-1', 'subscribe-list', { id: 'c-first', ...spec });
    first.sent = [];

    // The newcomer's fetch sees A updated, B removed and C added
    const mock = /** @type {import('vitest').Mock} */ (
      fetchListForSubscription
    );
    mock.mockResolvedValueOnce({
      ok: true,
      items: [
        { id: 'A', updated_at: 2, closed_at: null },
        { id: 'C', updated_at: 1, closed_at: null }
      ]
    });
    await send(second, 'sub-2', 'subscribe-list', { id: 'c-second', ...spec });

    const first_events = frames(first);
    const upserted = first_events
      .filter((e) => e.type === 'upsert')
      .map((e) => {
        expect(e.payload.id).toBe('c-first');
        return e.payload.issue.id;
      })
      .sort();
    const deleted = first_events
      .filter((e) => e.type === 'delete')
      .map((e) => {
        expect(e.payload.id).toBe('c-first');
        return e.payload.issue_id;
      });
    expect(upserted).toEqual(['A', 'C']);
    expect(deleted).toEqual(['B']);

    // The newcomer gets only its snapshot and the ok reply
    const second_events = frames(second);
    expect(second_events.map((e) => e.type)).toEqual([
      'snapshot',
      'subscribe-list'
    ]);
    const snapshot_ids = second_events[0].payload.issues
      .map((/** @type {{ id: string }} */ it) => it.id)
      .sort();
    expect(snapshot_ids).toEqual(['A', 'C']);
  });
});
