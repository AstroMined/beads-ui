import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  DOLT_JOURNAL_NAME,
  listStoreWatchTargets,
  readManifestFingerprint,
  readStoreSignature
} from './dolt-manifest.js';

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

/** A time well outside the journal settle window. */
const SETTLED = new Date(Date.UTC(2026, 0, 1));

/**
 * A Dolt server data dir holding database `db`, with a settled journal.
 */
function mkDataDir() {
  const data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-data-'));
  tmps.push(data_dir);
  fs.mkdirSync(path.join(data_dir, '.dolt'));
  fs.writeFileSync(
    path.join(data_dir, '.dolt', 'sql-server.info'),
    '4242:3417:cadcc1b5-74d4-4244-8a28-a3133188b64e'
  );
  const noms = path.join(data_dir, 'db', '.dolt', 'noms');
  fs.mkdirSync(noms, { recursive: true });
  fs.writeFileSync(path.join(noms, 'manifest'), 'root-a');
  const journal = path.join(noms, DOLT_JOURNAL_NAME);
  fs.writeFileSync(journal, 'chunk-1');
  fs.utimesSync(journal, SETTLED, SETTLED);
  return { data_dir, noms, journal };
}

/**
 * A server-mode workspace for database `db` on `host` and `port`.
 *
 * @param {string} [host]
 * @param {number} [port]
 */
function mkServerWorkspace(host = '127.0.0.1', port = 3417) {
  const root = mkWorkspace(
    JSON.stringify({
      dolt_mode: 'server',
      dolt_server_host: host,
      dolt_server_port: port,
      dolt_database: 'db'
    })
  );
  writeManifest(root, 'db', 'frozen-before-switch');
  return root;
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

describe('readManifestFingerprint on a local Dolt server', () => {
  test('is stable while the journal and manifest are unchanged', () => {
    const { data_dir } = mkDataDir();
    const root = mkServerWorkspace();
    const env = { BDUI_DOLT_DATA_DIR: data_dir };
    const before = readManifestFingerprint(root, env);
    expect(before).not.toBeNull();
    expect(readManifestFingerprint(root, env)).toBe(before);
  });

  test('changes when a write appends to the journal', () => {
    const { data_dir, journal } = mkDataDir();
    const root = mkServerWorkspace();
    const env = { BDUI_DOLT_DATA_DIR: data_dir };
    const before = readManifestFingerprint(root, env);
    fs.appendFileSync(journal, 'chunk-2');
    fs.utimesSync(journal, SETTLED, SETTLED);
    expect(readManifestFingerprint(root, env)).not.toBe(before);
  });

  test('changes when the manifest changes', () => {
    const { data_dir, noms } = mkDataDir();
    const root = mkServerWorkspace();
    const env = { BDUI_DOLT_DATA_DIR: data_dir };
    const before = readManifestFingerprint(root, env);
    fs.writeFileSync(path.join(noms, 'manifest'), 'root-b');
    expect(readManifestFingerprint(root, env)).not.toBe(before);
  });

  test('is null while the journal is inside the settle window', () => {
    const { data_dir, journal } = mkDataDir();
    const root = mkServerWorkspace();
    const now = new Date();
    fs.utimesSync(journal, now, now);
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toBeNull();
  });

  test('ignores the settle window for the store signature', () => {
    const { data_dir, journal } = mkDataDir();
    const root = mkServerWorkspace();
    const env = { BDUI_DOLT_DATA_DIR: data_dir };
    const settled = readStoreSignature(root, env);
    const now = new Date();
    fs.utimesSync(journal, now, now);
    const fresh = readStoreSignature(root, env);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(settled);
  });

  test('is null when another server owns the data dir', () => {
    const { data_dir } = mkDataDir();
    const root = mkServerWorkspace('127.0.0.1', 3418);
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toBeNull();
  });

  test('is null when no server info names the data dir port', () => {
    const { data_dir } = mkDataDir();
    fs.rmSync(path.join(data_dir, '.dolt', 'sql-server.info'));
    const root = mkServerWorkspace();
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toBeNull();
  });

  test('is null for a remote server host', () => {
    const { data_dir } = mkDataDir();
    const root = mkServerWorkspace('10.64.71.9');
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toBeNull();
  });

  test('is null when the data dir does not hold the database', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-ui-empty-'));
    tmps.push(empty);
    const root = mkServerWorkspace();
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: empty })
    ).toBeNull();
  });

  test('is null when the journal is missing', () => {
    const { data_dir, journal } = mkDataDir();
    fs.rmSync(journal);
    const root = mkServerWorkspace();
    expect(
      readManifestFingerprint(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toBeNull();
  });
});

describe('listStoreWatchTargets', () => {
  test('lists each embedded noms dir with its manifest', () => {
    const root = mkWorkspace();
    writeManifest(root, 'b', 'x');
    writeManifest(root, 'a', 'x');
    const dolt = path.join(root, '.beads', 'embeddeddolt');
    expect(listStoreWatchTargets(root, NO_ENV)).toEqual([
      { dir: path.join(dolt, 'a', '.dolt', 'noms'), files: ['manifest'] },
      { dir: path.join(dolt, 'b', '.dolt', 'noms'), files: ['manifest'] }
    ]);
  });

  test('lists the server noms dir with its manifest and journal', () => {
    const { data_dir, noms } = mkDataDir();
    const root = mkServerWorkspace();
    expect(
      listStoreWatchTargets(root, { BDUI_DOLT_DATA_DIR: data_dir })
    ).toEqual([{ dir: noms, files: ['manifest', DOLT_JOURNAL_NAME] }]);
  });

  test('lists nothing for a store with no known files', () => {
    const root = mkServerWorkspace('10.64.71.9');
    expect(listStoreWatchTargets(root, NO_ENV)).toEqual([]);
  });
});
