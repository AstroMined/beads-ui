import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as regMod from './registry-watcher.js';

/** @type {string | undefined} */
let tmp_dir;

beforeEach(() => {
  tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-reg-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  regMod.clearInMemoryWorkspaces();
  if (tmp_dir) {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
    tmp_dir = undefined;
  }
});

describe('readRegistry', () => {
  test('returns entries from valid JSON array', () => {
    const data = [
      {
        workspace_path: '/home/user/project',
        socket_path: '/tmp/sock',
        database_path: '/home/user/project/.beads/db.sqlite',
        pid: 1234,
        version: '0.57',
        started_at: '2026-01-01'
      }
    ];
    const real_path = regMod.getRegistryPath();
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, opts) => {
      if (String(p) === real_path) {
        return JSON.stringify(data);
      }
      return original.call(fs, p, opts);
    });

    const result = regMod.readRegistry();
    expect(result).toHaveLength(1);
    expect(result[0].workspace_path).toBe('/home/user/project');
  });

  test('returns empty array for invalid JSON', () => {
    const real_path = regMod.getRegistryPath();
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, opts) => {
      if (String(p) === real_path) {
        return 'not-json{{{';
      }
      return original.call(fs, p, opts);
    });

    const result = regMod.readRegistry();
    expect(result).toEqual([]);
  });

  test('returns empty array for missing file', () => {
    const real_path = regMod.getRegistryPath();
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, opts) => {
      if (String(p) === real_path) {
        throw new Error('ENOENT');
      }
      return original.call(fs, p, opts);
    });

    const result = regMod.readRegistry();
    expect(result).toEqual([]);
  });

  test('returns empty array for non-array JSON', () => {
    const real_path = regMod.getRegistryPath();
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, opts) => {
      if (String(p) === real_path) {
        return JSON.stringify({ not: 'array' });
      }
      return original.call(fs, p, opts);
    });

    const result = regMod.readRegistry();
    expect(result).toEqual([]);
  });
});

describe('registerWorkspace and getInMemoryWorkspaces', () => {
  test('registers workspace and retrieves it', () => {
    const unique = path.join(
      /** @type {string} */ (tmp_dir),
      'test-ws-' + Date.now()
    );
    regMod.registerWorkspace({ path: unique, database: unique + '/.beads/db' });

    const workspaces = regMod.getInMemoryWorkspaces();
    const entry = workspaces.find((w) => w.path === path.resolve(unique));
    expect(entry).toBeDefined();
    expect(entry?.database).toBe(unique + '/.beads/db');
    expect(entry?.version).toBe('dynamic');
  });
});

describe('getAvailableWorkspaces', () => {
  test('merges file registry, in-memory, and scan results with dedup', () => {
    // Mock readRegistry to return file-based entries
    vi.spyOn(regMod, 'readRegistry').mockReturnValue([
      {
        workspace_path: '/home/user/project-a',
        socket_path: '',
        database_path: '/home/user/project-a/.beads/db',
        pid: 100,
        version: '0.57',
        started_at: ''
      }
    ]);

    // Register an in-memory workspace (different path)
    const unique_b = '/home/user/project-b-' + Date.now();
    regMod.registerWorkspace({
      path: unique_b,
      database: unique_b + '/.beads/db'
    });

    // Scan results: one duplicate of project-a, one new
    const scan = [
      { workspace_path: '/home/user/project-a', name: 'project-a' },
      { workspace_path: '/home/user/project-c', name: 'project-c' }
    ];

    const result = regMod.getAvailableWorkspaces(scan);
    const paths = result.map((w) => path.resolve(w.path));

    expect(paths).toContain(path.resolve('/home/user/project-a'));
    expect(paths).toContain(path.resolve(unique_b));
    expect(paths).toContain(path.resolve('/home/user/project-c'));

    // project-a should not be duplicated
    const a_count = paths.filter(
      (p) => p === path.resolve('/home/user/project-a')
    ).length;
    expect(a_count).toBe(1);
  });
});

describe('findWorkspaceEntry', () => {
  /**
   * Mock fs.readFileSync so that readRegistry (called internally by
   * findWorkspaceEntry) returns the given entries.
   *
   * @param {unknown[]} entries
   */
  function mockFileRegistry(entries) {
    const real_path = regMod.getRegistryPath();
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((p, opts) => {
      if (String(p) === real_path) {
        return JSON.stringify(entries);
      }
      return original.call(fs, p, opts);
    });
  }

  test('returns entry for exact path match', () => {
    mockFileRegistry([
      {
        workspace_path: '/home/user/my-project',
        socket_path: '',
        database_path: '/home/user/my-project/.beads/db',
        pid: 42,
        version: '0.57',
        started_at: ''
      }
    ]);

    const result = regMod.findWorkspaceEntry('/home/user/my-project');
    expect(result).not.toBeNull();
    expect(result?.workspace_path).toBe('/home/user/my-project');
  });

  test('returns entry for subdirectory prefix match', () => {
    mockFileRegistry([
      {
        workspace_path: '/home/user/my-project',
        socket_path: '',
        database_path: '',
        pid: 42,
        version: '0.57',
        started_at: ''
      }
    ]);

    const result = regMod.findWorkspaceEntry(
      '/home/user/my-project/src/components'
    );
    expect(result).not.toBeNull();
    expect(result?.workspace_path).toBe('/home/user/my-project');
  });

  test('returns null when no match', () => {
    mockFileRegistry([]);

    const result = regMod.findWorkspaceEntry('/home/user/other');
    expect(result).toBeNull();
  });
});

describe('watchRegistry', () => {
  test('returns object with close method', () => {
    const watcher = regMod.watchRegistry(() => {}, { debounce_ms: 100 });
    expect(typeof watcher.close).toBe('function');
    watcher.close();
  });
});
