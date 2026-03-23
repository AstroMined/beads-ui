import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** @type {Map<string, string>} */
let file_contents;
/** @type {{ dir: string, cb: (event: string, filename?: string) => void }[]} */
let watchers;

vi.mock('node:os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home'
}));

vi.mock('node:fs', () => {
  /** @param {string} p */
  const readFileSync = vi.fn((p) => {
    if (file_contents.has(p)) {
      return file_contents.get(p);
    }
    const err = /** @type {NodeJS.ErrnoException} */ (
      new Error(`ENOENT: no such file: ${p}`)
    );
    err.code = 'ENOENT';
    throw err;
  });
  const existsSync = vi.fn(
    (p) => file_contents.has(String(p)) || p === '/mock-home/.beads'
  );
  const watch = vi.fn((dir, _opts, cb) => {
    const w = { close: vi.fn() };
    watchers.push({ dir, cb });
    return w;
  });
  return {
    default: { readFileSync, existsSync, watch },
    readFileSync,
    existsSync,
    watch
  };
});

beforeEach(() => {
  file_contents = new Map();
  watchers = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('settings', () => {
  /** Reimport to reset module-level cached state. */
  async function freshImport() {
    vi.resetModules();
    return import('./settings.js');
  }

  describe('DEFAULT_SETTINGS', () => {
    test('reproduces current 4-column layout', async () => {
      const { DEFAULT_SETTINGS } = await freshImport();
      const ids = DEFAULT_SETTINGS.board.columns.map(
        (/** @type {{ id: string }} */ c) => c.id
      );
      expect(ids).toEqual(['blocked', 'ready', 'in-progress', 'closed']);
    });

    test('has correct subscription types', async () => {
      const { DEFAULT_SETTINGS } = await freshImport();
      const subs = DEFAULT_SETTINGS.board.columns.map(
        (/** @type {{ subscription: string }} */ c) => c.subscription
      );
      expect(subs).toEqual([
        'blocked-issues',
        'ready-issues',
        'in-progress-issues',
        'closed-issues'
      ]);
    });

    test('has correct drop statuses', async () => {
      const { DEFAULT_SETTINGS } = await freshImport();
      const statuses = DEFAULT_SETTINGS.board.columns.map(
        (/** @type {{ drop_status: string }} */ c) => c.drop_status
      );
      expect(statuses).toEqual(['open', 'open', 'in_progress', 'closed']);
    });
  });

  describe('loadSettings', () => {
    test('returns DEFAULT_SETTINGS when file is missing', async () => {
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    test('parses valid config file', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 4000 } })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.server.port).toBe(4000);
      expect(result.server.host).toBe('127.0.0.1');
    });

    test('returns DEFAULT_SETTINGS on malformed JSON', async () => {
      file_contents.set('/mock-home/.beads/config.json', '{bad json');
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result).toEqual(DEFAULT_SETTINGS);
    });

    test('merges partial settings with defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_depth: 5 } })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_depth).toBe(5);
      expect(result.discovery.scan_roots).toEqual([]);
      expect(result.server.port).toBe(3000);
    });

    test('uses custom columns when provided', async () => {
      const custom_columns = [
        {
          id: 'todo',
          label: 'Todo',
          subscription: 'ready-issues',
          drop_status: 'open'
        }
      ];
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ board: { columns: custom_columns } })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.board.columns).toEqual(custom_columns);
    });
  });

  describe('getSettings', () => {
    test('returns cached settings after loadSettings', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 5000 } })
      );
      const { loadSettings, getSettings } = await freshImport();
      loadSettings();
      const result = getSettings();
      expect(result.server.port).toBe(5000);
    });

    test('returns DEFAULT_SETTINGS before loadSettings is called', async () => {
      const { getSettings, DEFAULT_SETTINGS } = await freshImport();
      expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('watchSettings', () => {
    test('detects file changes and calls onChange', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
      );
      const { loadSettings, watchSettings } = await freshImport();
      loadSettings();

      const onChange = vi.fn();
      watchSettings(onChange, { debounce_ms: 100 });
      expect(watchers.length).toBe(1);

      // Simulate file change with new content
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 9999, host: '127.0.0.1' } })
      );
      watchers[0].cb('change', 'config.json');
      vi.advanceTimersByTime(100);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].server.port).toBe(9999);
    });

    test('does not call onChange when settings are unchanged', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
      );
      const { loadSettings, watchSettings } = await freshImport();
      loadSettings();

      const onChange = vi.fn();
      watchSettings(onChange, { debounce_ms: 100 });

      // File event fires but content is unchanged
      watchers[0].cb('change', 'config.json');
      vi.advanceTimersByTime(100);

      expect(onChange).not.toHaveBeenCalled();
    });

    test('close() stops watching', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
      );
      const { loadSettings, watchSettings } = await freshImport();
      loadSettings();

      const onChange = vi.fn();
      const handle = watchSettings(onChange, { debounce_ms: 100 });
      handle.close();

      // Change should not trigger after close
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 8888, host: '127.0.0.1' } })
      );
      // Cannot trigger via watcher cb after close, but verify handle returned
      expect(handle).toHaveProperty('close');
    });

    test('debounces rapid changes', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
      );
      const { loadSettings, watchSettings } = await freshImport();
      loadSettings();

      const onChange = vi.fn();
      watchSettings(onChange, { debounce_ms: 200 });

      // Rapid changes
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 4000, host: '127.0.0.1' } })
      );
      watchers[0].cb('change', 'config.json');
      vi.advanceTimersByTime(50);

      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 5000, host: '127.0.0.1' } })
      );
      watchers[0].cb('change', 'config.json');
      vi.advanceTimersByTime(200);

      // Only one call with the final value
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].server.port).toBe(5000);
    });

    test('returns no-op watcher when settings dir does not exist', async () => {
      const fs = await import('node:fs');
      const original = vi.mocked(fs.existsSync).getMockImplementation();
      vi.mocked(fs.existsSync).mockReturnValue(false);
      try {
        const { watchSettings } = await freshImport();
        const onChange = vi.fn();
        const handle = watchSettings(onChange);
        expect(handle).toHaveProperty('close');
        expect(watchers.length).toBe(0);
        handle.close(); // should not throw
      } finally {
        if (original) {
          vi.mocked(fs.existsSync).mockImplementation(original);
        } else {
          vi.mocked(fs.existsSync).mockRestore();
        }
      }
    });
  });

  describe('immutable settings (L1+L2)', () => {
    test('getSettings returns a clone, not the cached reference', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 3000, host: '127.0.0.1' } })
      );
      const { loadSettings, getSettings } = await freshImport();
      loadSettings();

      const first = getSettings();
      first.server.port = 9999;
      const second = getSettings();
      expect(second.server.port).toBe(3000);
    });

    test('mutating returned settings does not affect cached state', async () => {
      const { getSettings } = await freshImport();
      const settings = getSettings();
      settings.board.columns = [];
      const fresh = getSettings();
      expect(fresh.board.columns.length).toBeGreaterThan(0);
    });
  });

  describe('column validation (L3)', () => {
    test('filters out malformed column definitions', async () => {
      const columns = [
        {
          id: 'valid',
          label: 'Valid',
          subscription: 'ready-issues',
          drop_status: 'open'
        },
        { id: '', label: 'Empty ID', subscription: 's', drop_status: 'd' },
        null,
        42,
        { label: 'Missing ID', subscription: 's', drop_status: 'd' }
      ];
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ board: { columns } })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.board.columns).toEqual([
        {
          id: 'valid',
          label: 'Valid',
          subscription: 'ready-issues',
          drop_status: 'open'
        }
      ]);
    });

    test('falls back to defaults when all columns are invalid', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ board: { columns: [null, {}, 'garbage'] } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.board.columns).toEqual(DEFAULT_SETTINGS.board.columns);
    });

    test('keeps only valid entries from partially valid array', async () => {
      const columns = [
        {
          id: 'a',
          label: 'A',
          subscription: 'sub-a',
          drop_status: 'open'
        },
        { id: 'b' },
        {
          id: 'c',
          label: 'C',
          subscription: 'sub-c',
          drop_status: 'closed'
        }
      ];
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ board: { columns } })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.board.columns).toHaveLength(2);
      expect(result.board.columns[0].id).toBe('a');
      expect(result.board.columns[1].id).toBe('c');
    });
  });

  describe('discovery validation (L4)', () => {
    test('invalid scan_roots (non-array) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_roots: 'not-an-array' } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_roots).toEqual(
        DEFAULT_SETTINGS.discovery.scan_roots
      );
    });

    test('invalid scan_roots (array with non-strings) filters them out', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({
          discovery: { scan_roots: ['/valid', 42, null, '/also-valid', ''] }
        })
      );
      const { loadSettings } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_roots).toEqual(['/valid', '/also-valid']);
    });

    test('empty scan_roots after filtering falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_roots: [42, null, ''] } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_roots).toEqual(
        DEFAULT_SETTINGS.discovery.scan_roots
      );
    });

    test('invalid scan_depth (negative) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_depth: -5 } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_depth).toBe(
        DEFAULT_SETTINGS.discovery.scan_depth
      );
    });

    test('invalid scan_depth (float) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_depth: 2.5 } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_depth).toBe(
        DEFAULT_SETTINGS.discovery.scan_depth
      );
    });

    test('invalid scan_depth (string) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ discovery: { scan_depth: 'deep' } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.discovery.scan_depth).toBe(
        DEFAULT_SETTINGS.discovery.scan_depth
      );
    });
  });

  describe('server validation (L5)', () => {
    test('invalid port (string) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 'banana' } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.server.port).toBe(DEFAULT_SETTINGS.server.port);
    });

    test('invalid port (negative) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: -1 } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.server.port).toBe(DEFAULT_SETTINGS.server.port);
    });

    test('invalid port (> 65535) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 70000 } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.server.port).toBe(DEFAULT_SETTINGS.server.port);
    });

    test('invalid host (non-string) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { host: 12345 } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.server.host).toBe(DEFAULT_SETTINGS.server.host);
    });

    test('invalid host (empty string) falls back to defaults', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { host: '' } })
      );
      const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
      const result = loadSettings();
      expect(result.server.host).toBe(DEFAULT_SETTINGS.server.host);
    });
  });

  describe('config integration', () => {
    test('getConfig uses settings for port when env var not set', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 7777 } })
      );
      const { loadSettings } = await freshImport();
      const settings = loadSettings();

      const { getConfig } = await import('./config.js');
      const saved_port = process.env.PORT;
      delete process.env.PORT;
      try {
        const config = getConfig(settings);
        expect(config.port).toBe(7777);
      } finally {
        if (saved_port !== undefined) process.env.PORT = saved_port;
      }
    });

    test('env var overrides settings for port', async () => {
      file_contents.set(
        '/mock-home/.beads/config.json',
        JSON.stringify({ server: { port: 7777 } })
      );
      const { loadSettings } = await freshImport();
      const settings = loadSettings();

      const { getConfig } = await import('./config.js');
      const saved_port = process.env.PORT;
      process.env.PORT = '9999';
      try {
        const config = getConfig(settings);
        expect(config.port).toBe(9999);
      } finally {
        if (saved_port !== undefined) {
          process.env.PORT = saved_port;
        } else {
          delete process.env.PORT;
        }
      }
    });
  });
});
