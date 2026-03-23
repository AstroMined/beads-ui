import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { scanForWorkspaces } from './discovery.js';

/** @type {string[]} */
const tmps = [];

function mkdtemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-discovery-test-'));
  tmps.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmps.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

describe('scanForWorkspaces', () => {
  test('discovers project with .beads/*.db file', () => {
    const root = mkdtemp();
    const project = path.join(root, 'my-project');
    fs.mkdirSync(path.join(project, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(project, '.beads', 'project.db'), '');

    const results = scanForWorkspaces([root], 2);
    expect(results).toHaveLength(1);
    expect(results[0].workspace_path).toBe(project);
    expect(results[0].name).toBe('my-project');
  });

  test('discovers project with .beads/metadata.json', () => {
    const root = mkdtemp();
    const project = path.join(root, 'meta-project');
    fs.mkdirSync(path.join(project, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(project, '.beads', 'metadata.json'), '{}');

    const results = scanForWorkspaces([root], 2);
    expect(results).toHaveLength(1);
    expect(results[0].workspace_path).toBe(project);
    expect(results[0].name).toBe('meta-project');
  });

  test('depth=1 finds immediate children only', () => {
    const root = mkdtemp();
    const child = path.join(root, 'child');
    const grandchild = path.join(child, 'grandchild');
    fs.mkdirSync(path.join(child, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(child, '.beads', 'a.db'), '');
    fs.mkdirSync(path.join(grandchild, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(grandchild, '.beads', 'b.db'), '');

    const results = scanForWorkspaces([root], 1);
    expect(results).toHaveLength(1);
    expect(results[0].workspace_path).toBe(child);
  });

  test('depth=2 finds grandchildren', () => {
    const root = mkdtemp();
    const child = path.join(root, 'child');
    const grandchild = path.join(child, 'grandchild');
    fs.mkdirSync(path.join(grandchild, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(grandchild, '.beads', 'c.db'), '');

    const results = scanForWorkspaces([root], 2);
    expect(results).toHaveLength(1);
    expect(results[0].workspace_path).toBe(grandchild);
  });

  test('skips node_modules directories', () => {
    const root = mkdtemp();
    const nm = path.join(root, 'node_modules', 'some-pkg');
    fs.mkdirSync(path.join(nm, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(nm, '.beads', 'x.db'), '');

    const results = scanForWorkspaces([root], 3);
    expect(results).toHaveLength(0);
  });

  test('skips .git directories', () => {
    const root = mkdtemp();
    const git = path.join(root, '.git', 'modules', 'sub');
    fs.mkdirSync(path.join(git, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(git, '.beads', 'x.db'), '');

    const results = scanForWorkspaces([root], 4);
    expect(results).toHaveLength(0);
  });

  test('skips hidden directories', () => {
    const root = mkdtemp();
    const hidden = path.join(root, '.hidden-dir');
    fs.mkdirSync(path.join(hidden, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(hidden, '.beads', 'x.db'), '');

    const results = scanForWorkspaces([root], 2);
    expect(results).toHaveLength(0);
  });

  test('empty roots returns empty array', () => {
    const results = scanForWorkspaces([], 2);
    expect(results).toHaveLength(0);
  });

  test('nonexistent root returns empty array', () => {
    const results = scanForWorkspaces(['/nonexistent/path/abc123'], 2);
    expect(results).toHaveLength(0);
  });

  test('ignores .beads/ with no db or metadata files', () => {
    const root = mkdtemp();
    const project = path.join(root, 'empty-beads');
    fs.mkdirSync(path.join(project, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(project, '.beads', 'config.yaml'), '');

    const results = scanForWorkspaces([root], 2);
    expect(results).toHaveLength(0);
  });

  test('discovers multiple projects across roots', () => {
    const root1 = mkdtemp();
    const root2 = mkdtemp();
    const p1 = path.join(root1, 'proj-a');
    const p2 = path.join(root2, 'proj-b');
    fs.mkdirSync(path.join(p1, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(p1, '.beads', 'a.db'), '');
    fs.mkdirSync(path.join(p2, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(p2, '.beads', 'b.db'), '');

    const results = scanForWorkspaces([root1, root2], 2);
    expect(results).toHaveLength(2);
    const paths = results.map((r) => r.workspace_path);
    expect(paths).toContain(p1);
    expect(paths).toContain(p2);
  });
});
