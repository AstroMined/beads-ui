import { beforeEach, describe, expect, test, vi } from 'vitest';
import { listStoreWatchTargets, readStoreSignature } from './dolt-manifest.js';
import { watchDb } from './watcher.js';

/** @type {{ dir: string, cb: (event: string, filename?: string) => void, w: { close: () => void } }[]} */
const watchers = [];

vi.mock('node:fs', () => {
  const watch = vi.fn((dir, _opts, cb) => {
    // Minimal event emitter interface for FSWatcher
    const handlers = /** @type {{ close: Array<() => void> }} */ ({
      close: []
    });
    const w = {
      close: () => handlers.close.forEach((fn) => fn())
    };
    watchers.push({ dir, cb, w });
    return /** @type {any} */ (w);
  });
  return { default: { watch }, watch };
});

vi.mock('./dolt-manifest.js', () => ({
  listStoreWatchTargets: vi.fn(() => []),
  readStoreSignature: vi.fn(() => null)
}));

beforeEach(() => {
  watchers.length = 0;
  vi.mocked(listStoreWatchTargets).mockReturnValue([]);
  vi.mocked(readStoreSignature).mockReturnValue(null);
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('watchDb', () => {
  test('debounces rapid change events', () => {
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 100,
      explicit_db: '/repo/.beads/ui.db'
    });
    expect(watchers.length).toBe(1);
    const { cb } = watchers[0];

    // Fire multiple changes in quick succession
    cb('change', 'ui.db');
    cb('change', 'ui.db');
    cb('rename', 'ui.db');

    // Nothing yet until debounce passes
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(99);
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls.length).toBe(1);

    // Cleanup
    handle.close();
  });

  test('ignores other filenames', () => {
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 50,
      explicit_db: '/repo/.beads/ui.db'
    });
    const { cb } = watchers[0];
    cb('change', 'something-else.db');
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(0);
    handle.close();
  });

  test('rebind attaches to new db path', () => {
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 50,
      explicit_db: '/repo/.beads/ui.db'
    });
    expect(watchers.length).toBe(1);
    const first = watchers[0];

    // Rebind to a different DB path
    handle.rebind({ explicit_db: '/other/.beads/alt.db' });

    // A new watcher is created
    expect(watchers.length).toBe(2);
    const second = watchers[1];

    // Old watcher should ignore new file name
    first.cb('change', 'ui.db');
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(0);

    // New watcher reacts
    second.cb('change', 'alt.db');
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(1);

    handle.close();
  });

  test('defers a change during the cooldown to its end when the store moved', () => {
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 10,
      cooldown_ms: 100,
      explicit_db: '/repo/.beads/ui.db'
    });
    const { cb } = watchers[0];

    vi.mocked(readStoreSignature).mockReturnValue('sig-1');
    cb('change', 'ui.db');
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(1);

    // Two writes inside the cooldown coalesce into one refresh at its end
    vi.mocked(readStoreSignature).mockReturnValue('sig-2');
    cb('change', 'ui.db');
    vi.advanceTimersByTime(40);
    cb('change', 'ui.db');
    vi.advanceTimersByTime(59);
    expect(calls.length).toBe(1);
    vi.advanceTimersByTime(1 + 10);
    expect(calls.length).toBe(2);

    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(2);

    handle.close();
  });

  test.each([
    ['an unchanged', 'sig-1'],
    ['no', null]
  ])(
    'drops a change during the cooldown with %s store signature',
    (_, after) => {
      const calls = [];
      const handle = watchDb('/repo', () => calls.push(null), {
        debounce_ms: 10,
        cooldown_ms: 100,
        explicit_db: '/repo/.beads/ui.db'
      });
      const { cb } = watchers[0];

      vi.mocked(readStoreSignature).mockReturnValue('sig-1');
      cb('change', 'ui.db');
      vi.advanceTimersByTime(10);
      expect(calls.length).toBe(1);

      // A bd read during the refresh touches a watched file
      vi.mocked(readStoreSignature).mockReturnValue(after);
      cb('change', 'ui.db');
      vi.advanceTimersByTime(1000);
      expect(calls.length).toBe(1);

      handle.close();
    }
  );

  test('close cancels a change deferred by the cooldown', () => {
    vi.mocked(readStoreSignature).mockReturnValueOnce('sig-1');
    vi.mocked(readStoreSignature).mockReturnValue('sig-2');
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 10,
      cooldown_ms: 100,
      explicit_db: '/repo/.beads/ui.db'
    });
    const { cb } = watchers[0];
    cb('change', 'ui.db');
    vi.advanceTimersByTime(10);
    cb('change', 'ui.db');
    handle.close();
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(1);
  });

  test('a change to an embedded Dolt manifest schedules a refresh', () => {
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: '/repo/.beads/embeddeddolt/pw/.dolt/noms', files: ['manifest'] }
    ]);
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 10,
      explicit_db: '/repo/.beads/ui.db'
    });
    expect(watchers.map((w) => w.dir)).toEqual([
      '/repo/.beads',
      '/repo/.beads/embeddeddolt/pw/.dolt/noms'
    ]);
    const noms = watchers[1];

    noms.cb('change', 'LOCK');
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(0);

    noms.cb('change', 'manifest');
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(1);

    handle.close();
  });

  test('rebind and close release the manifest watchers', () => {
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: '/repo/.beads/embeddeddolt/pw/.dolt/noms', files: ['manifest'] }
    ]);
    const handle = watchDb('/repo', () => {}, {
      explicit_db: '/repo/.beads/ui.db'
    });
    const closes = watchers.map((w) => vi.spyOn(w.w, 'close'));

    handle.rebind({ explicit_db: '/other/.beads/alt.db' });
    expect(closes.map((c) => c.mock.calls.length)).toEqual([1, 1]);

    const later = watchers.slice(2).map((w) => vi.spyOn(w.w, 'close'));
    handle.close();
    expect(later.map((c) => c.mock.calls.length)).toEqual([1, 1]);
  });

  test('a server journal write schedules a refresh; LOCK does not', () => {
    const noms_dir = '/data/bd-server/pw/.dolt/noms';
    const journal = 'v'.repeat(32);
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: noms_dir, files: ['manifest', journal] }
    ]);
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 10,
      explicit_db: '/repo/.beads/ui.db'
    });
    const noms = watchers.find((w) => w.dir === noms_dir);
    expect(noms).toBeDefined();

    noms?.cb('change', 'LOCK');
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(0);

    noms?.cb('change', journal);
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(1);

    handle.close();
  });

  test('a metadata.json change re-targets the store watchers', () => {
    const calls = [];
    const handle = watchDb('/repo', () => calls.push(null), {
      debounce_ms: 10,
      cooldown_ms: 0,
      explicit_db: '/repo/.beads/ui.db'
    });
    expect(watchers.map((w) => w.dir)).toEqual(['/repo/.beads']);
    const old_dir = '/repo/.beads/embeddeddolt/pw/.dolt/noms';
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: old_dir, files: ['manifest'] }
    ]);
    watchers[0].cb('change', 'metadata.json');
    const embedded = watchers[1];
    expect(embedded.dir).toBe(old_dir);
    const embedded_close = vi.spyOn(embedded.w, 'close');

    const server_dir = '/data/bd-server/pw/.dolt/noms';
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: server_dir, files: ['manifest', 'v'.repeat(32)] }
    ]);
    watchers[0].cb('rename', 'metadata.json');
    expect(embedded_close).toHaveBeenCalledTimes(1);
    expect(watchers.map((w) => w.dir)).toEqual([
      '/repo/.beads',
      old_dir,
      server_dir
    ]);

    vi.advanceTimersByTime(10);
    const before = calls.length;
    watchers[2].cb('change', 'v'.repeat(32));
    vi.advanceTimersByTime(10);
    expect(calls.length).toBe(before + 1);

    handle.close();
  });

  test('a .beads event binds a store that appeared after the watcher', () => {
    const handle = watchDb('/repo', () => {}, {
      explicit_db: '/repo/.beads/ui.db'
    });
    expect(watchers.map((w) => w.dir)).toEqual(['/repo/.beads']);
    const server_dir = '/data/bd-server/pw/.dolt/noms';
    vi.mocked(listStoreWatchTargets).mockReturnValue([
      { dir: server_dir, files: ['manifest', 'v'.repeat(32)] }
    ]);
    watchers[0].cb('change', 'last-touched');
    expect(watchers.map((w) => w.dir)).toEqual(['/repo/.beads', server_dir]);

    // Bound now: an unrelated event does not re-target again
    watchers[0].cb('change', 'last-touched');
    expect(watchers.length).toBe(2);

    handle.close();
  });
});
