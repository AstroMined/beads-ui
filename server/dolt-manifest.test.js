import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readManifestFingerprint } from './dolt-manifest.js';

/** @type {string[]} */
const tmps = [];

/**
 * An environment with no Dolt server variable set.
 *
 * @type {NodeJS.ProcessEnv}
 */
const NO_ENV = {};

/**
 * Create a workspace with `.beads/metadata.json` and return its root.
 *
 * @param {string} [metadata] - Raw metadata.json content.
 */
function mkWorkspace(metadata = '{}') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-manifest-'));
  tmps.push(dir);
  fs.mkdirSync(path.join(dir, '.beads'));
  fs.writeFileSync(path.join(dir, '.beads', 'metadata.json'), metadata);
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
    expect(readManifestFingerprint(dir, NO_ENV)).toBeNull();
  });

  test('returns null when the workspace has no Dolt manifest', () => {
    expect(readManifestFingerprint(mkWorkspace(), NO_ENV)).toBeNull();
  });

  test('is stable across mtime-only changes', () => {
    const root = mkWorkspace();
    const file = writeManifest(root, 'db', 'root-a');
    const before = readManifestFingerprint(root, NO_ENV);
    const later = new Date(Date.UTC(2030, 0, 1));
    fs.utimesSync(file, later, later);
    expect(before).not.toBeNull();
    expect(readManifestFingerprint(root, NO_ENV)).toBe(before);
  });

  test('changes when the manifest content changes', () => {
    const root = mkWorkspace();
    writeManifest(root, 'db', 'root-a');
    const before = readManifestFingerprint(root, NO_ENV);
    writeManifest(root, 'db', 'root-b');
    expect(readManifestFingerprint(root, NO_ENV)).not.toBe(before);
  });

  test('resolves from a subdirectory of the workspace', () => {
    const root = mkWorkspace();
    writeManifest(root, 'db', 'root-a');
    const sub = path.join(root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    expect(readManifestFingerprint(sub, NO_ENV)).toBe(
      readManifestFingerprint(root, NO_ENV)
    );
  });

  test('fingerprints a workspace that names the embedded mode', () => {
    const root = mkWorkspace(JSON.stringify({ dolt_mode: 'embedded' }));
    writeManifest(root, 'db', 'root-a');
    expect(readManifestFingerprint(root, NO_ENV)).not.toBeNull();
  });

  test.each([
    ['server mode', { dolt_mode: 'server', dolt_server_host: '127.0.0.1' }],
    ['a server host with no mode', { dolt_server_host: '127.0.0.1' }],
    ['an unknown mode', { dolt_mode: 'proxied' }]
  ])('returns null for %s even with a frozen embedded manifest', (_, meta) => {
    const root = mkWorkspace(JSON.stringify(meta));
    writeManifest(root, 'db', 'root-a');
    expect(readManifestFingerprint(root, NO_ENV)).toBeNull();
  });

  test('returns null when metadata.json does not parse', () => {
    const root = mkWorkspace('{not json');
    writeManifest(root, 'db', 'root-a');
    expect(readManifestFingerprint(root, NO_ENV)).toBeNull();
  });

  test.each([
    'BEADS_DOLT_SERVER_MODE',
    'BEADS_DOLT_SERVER_HOST',
    'BEADS_DOLT_SHARED_SERVER',
    'BEADS_DOLT_PROXIED_SERVER',
    'BEADS_DOLT_PORT'
  ])('returns null when %s selects a server', (name) => {
    const root = mkWorkspace();
    writeManifest(root, 'db', 'root-a');
    expect(readManifestFingerprint(root, { [name]: '1' })).toBeNull();
  });
});
