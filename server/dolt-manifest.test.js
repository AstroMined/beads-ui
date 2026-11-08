import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readManifestFingerprint } from './dolt-manifest.js';

/** @type {string[]} */
const tmps = [];

/**
 * Create a workspace with `.beads/metadata.json` and return its root.
 */
function mkWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-manifest-'));
  tmps.push(dir);
  fs.mkdirSync(path.join(dir, '.beads'));
  fs.writeFileSync(path.join(dir, '.beads', 'metadata.json'), '{}');
  return dir;
}

/**
 * @param {string} root
 * @param {string} db
 * @param {string} content
 */
function writeManifest(root, db, content) {
  const noms = path.join(root, '.beads', 'embeddeddolt', db, '.dolt', 'noms');
  fs.mkdirSync(noms, { recursive: true });
  const file = path.join(noms, 'manifest');
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const d of tmps.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('readManifestFingerprint', () => {
  test('returns null without a beads workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-none-'));
    tmps.push(dir);
    expect(readManifestFingerprint(dir)).toBeNull();
  });

  test('returns null when the workspace has no Dolt manifest', () => {
    expect(readManifestFingerprint(mkWorkspace())).toBeNull();
  });

  test('is stable across mtime-only changes', () => {
    const root = mkWorkspace();
    const file = writeManifest(root, 'db', 'root-a');
    const before = readManifestFingerprint(root);
    const later = new Date(Date.UTC(2030, 0, 1));
    fs.utimesSync(file, later, later);
    expect(before).not.toBeNull();
    expect(readManifestFingerprint(root)).toBe(before);
  });

  test('changes when the manifest content changes', () => {
    const root = mkWorkspace();
    writeManifest(root, 'db', 'root-a');
    const before = readManifestFingerprint(root);
    writeManifest(root, 'db', 'root-b');
    expect(readManifestFingerprint(root)).not.toBe(before);
  });

  test('resolves from a subdirectory of the workspace', () => {
    const root = mkWorkspace();
    writeManifest(root, 'db', 'root-a');
    const sub = path.join(root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    expect(readManifestFingerprint(sub)).toBe(readManifestFingerprint(root));
  });
});
