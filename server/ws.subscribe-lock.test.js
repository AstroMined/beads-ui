import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readManifestFingerprint } from './dolt-manifest.js';
import { fetchListForSubscription } from './list-adapters.js';
import { keyOf, registry } from './subscriptions.js';
import { attachWsServer, handleMessage, scheduleListRefresh } from './ws.js';

vi.mock('./dolt-manifest.js', () => ({ readManifestFingerprint: vi.fn() }));
vi.mock('./list-adapters.js', () => ({ fetchListForSubscription: vi.fn() }));

const DEBOUNCE_MS = 50;

const SPEC = { type: 'all-issues' };

/** Rows before the external write. */
const BEFORE_WRITE = [{ id: 'W-1', title: 'Before', updated_at: 1 }];
/** Rows after the external write. */
const AFTER_WRITE = [{ id: 'W-1', title: 'After', updated_at: 2 }];

const mock_fetch = /** @type {import('vitest').Mock} */ (
  fetchListForSubscription
);
const mock_fingerprint = /** @type {import('vitest').Mock} */ (
  readManifestFingerprint
);

function makeSocket() {
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
 * @param {ReturnType<typeof makeSocket>} sock
 * @param {string} client_id
 */
function subscribe(sock, client_id) {
  return handleMessage(
    /** @type {any} */ (sock),
    Buffer.from(
      JSON.stringify({
        id: `sub-${client_id}`,
        type: /** @type {any} */ ('subscribe-list'),
        payload: { id: client_id, ...SPEC }
      })
    )
  );
}

/**
 * Title of `W-1` in the last snapshot or upsert a socket received.
 *
 * @param {ReturnType<typeof makeSocket>} sock
 * @returns {unknown}
 */
function lastTitle(sock) {
  /** @type {unknown} */
  let title = null;
  for (const raw of sock.sent) {
    const msg = JSON.parse(raw);
    if (msg.type === 'snapshot') {
      title = msg.payload.issues[0]?.title ?? null;
    } else if (msg.type === 'upsert') {
      title = msg.payload.issue.title;
    }
  }
  return title;
}

beforeEach(() => {
  vi.useFakeTimers();
  registry.clear();
  mock_fetch.mockReset();
  mock_fingerprint.mockReset();
  mock_fingerprint.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscribe-list snapshot under the key lock', () => {
  test('a snapshot read before a write cannot overwrite a newer refresh', async () => {
    const { wss } = attachWsServer(createServer(), {
      path: '/ws',
      refresh_debounce_ms: DEBOUNCE_MS
    });
    const first = makeSocket();
    const second = makeSocket();
    wss.clients.add(/** @type {any} */ (first));
    wss.clients.add(/** @type {any} */ (second));

    mock_fetch.mockResolvedValueOnce({ ok: true, items: BEFORE_WRITE });
    await subscribe(first, 'c-first');

    /** @type {() => void} */
    let finish_stale = () => {};
    mock_fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish_stale = () => resolve({ ok: true, items: BEFORE_WRITE });
        })
    );
    mock_fetch.mockImplementation(async () => ({
      ok: true,
      items: AFTER_WRITE
    }));

    // The second snapshot reads before the write; the write's refresh pass
    // starts while that read is still in flight.
    const second_subscribe = subscribe(second, 'c-second');
    scheduleListRefresh();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    finish_stale();
    await second_subscribe;
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(registry.get(keyOf(SPEC))?.itemsById.get('W-1')).toMatchObject({
      updated_at: AFTER_WRITE[0].updated_at
    });
    expect(lastTitle(first)).toBe('After');
    expect(lastTitle(second)).toBe('After');
  });

  test('a failed snapshot restores the client id previous subscription', async () => {
    attachWsServer(createServer(), { path: '/ws' });
    const sock = makeSocket();

    mock_fetch.mockResolvedValueOnce({ ok: true, items: BEFORE_WRITE });
    await subscribe(sock, 'c-reuse');
    mock_fetch.mockResolvedValueOnce({
      ok: false,
      error: { code: 'bd_error', message: 'locked' }
    });
    await subscribe(sock, 'c-reuse');

    const reply = JSON.parse(sock.sent.at(-1) ?? '{}');
    expect(reply.ok).toBe(false);
    expect(
      registry.get(keyOf(SPEC))?.subscribers.has(/** @type {any} */ (sock))
    ).toBe(true);
  });
});
