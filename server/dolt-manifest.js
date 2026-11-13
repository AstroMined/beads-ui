import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findNearestBeadsMetadata } from './db.js';

/**
 * Environment variables through which bd reaches a Dolt server instead of the
 * store metadata.json names. Any of them set means no local file is known to
 * hold the data bd reads.
 */
const SERVER_ENV_PREFIX = 'BEADS_DOLT_SERVER_';
const SERVER_ENV_NAMES = Object.freeze([
  'BEADS_DOLT_SHARED_SERVER',
  'BEADS_DOLT_PROXIED_SERVER',
  'BEADS_DOLT_PORT'
]);

/** Directory the local Dolt server keeps one database directory per name in. */
export const DEFAULT_DOLT_DATA_DIR = path.join(
  os.homedir(),
  '.local',
  'share',
  'bd-server'
);

/** File name of the chunk journal every Dolt server write appends to. */
export const DOLT_JOURNAL_NAME = 'v'.repeat(32);

/** File name of a Dolt database's root manifest. */
const MANIFEST_NAME = 'manifest';

/**
 * A journal written this recently may still be taking a write the caller's
 * next bd read would miss, so its fingerprint reads as "changed".
 */
export const JOURNAL_SETTLE_MS = 2000;

/**
 * File a running Dolt server writes in its data dir as `pid:port:uuid`. The
 * port tells which server owns the data dir; its config.yaml need not.
 */
const SERVER_INFO_PATH = path.join('.dolt', 'sql-server.info');

/** Database names usable as a directory below the data dir. */
const DATABASE_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * The store bd reads for a workspace: the embedded databases below
 * `.beads/embeddeddolt`, one database of a loopback Dolt server whose data
 * directory is on this host, or none known.
 *
 * @typedef {{ kind: 'embedded', dolt_root: string }
 *   | { kind: 'server', noms: string }
 *   | { kind: 'none' }} DoltStore
 */

/**
 * Fingerprint of the Dolt store of a workspace. Equal fingerprints mean the
 * bead data has not changed.
 *
 * - Embedded: the content of every database manifest. A read-only bd call
 *   rewrites a manifest's mtime but not its content, while every bd write
 *   changes it (`manifest_probe` in `server/fixtures/bd-ready-parity.json`).
 * - Server: the chunk journal's inode, size and mtime plus the manifest
 *   content. A server write appends to the journal and can leave the manifest
 *   unchanged.
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @param {NodeJS.ProcessEnv} [env] - Environment bd runs with.
 * @returns {string | null} Hex digest, or null when no store file is known to
 * hold the data or a server journal was written within `JOURNAL_SETTLE_MS`
 * (callers must then treat data as changed).
 */
export function readManifestFingerprint(cwd, env = process.env) {
  return storeFingerprint(resolveDoltStore(cwd, env), true);
}

/**
 * The store fingerprint without the journal settle window: it tells whether
 * the store files changed since an earlier read, not whether the data is
 * safe to reuse.
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @param {NodeJS.ProcessEnv} [env] - Environment bd runs with.
 * @returns {string | null} Hex digest, or null when no store file is known to
 * hold the data.
 */
export function readStoreSignature(cwd, env = process.env) {
  return storeFingerprint(resolveDoltStore(cwd, env), false);
}

/**
 * @param {DoltStore} store
 * @param {boolean} settle - Read a journal younger than `JOURNAL_SETTLE_MS`
 * as null.
 * @returns {string | null}
 */
function storeFingerprint(store, settle) {
  if (store.kind === 'embedded') {
    return embeddedFingerprint(store.dolt_root);
  }
  if (store.kind === 'server') {
    return serverFingerprint(store.noms, settle);
  }
  return null;
}

/**
 * Directories to watch for the Dolt store writes of a workspace, each with
 * the file names in it that a write changes. A directory is listed even when
 * those files do not exist yet.
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @param {NodeJS.ProcessEnv} [env] - Environment bd runs with.
 * @returns {{ dir: string, files: string[] }[]}
 */
export function listStoreWatchTargets(cwd, env = process.env) {
  const store = resolveDoltStore(cwd, env);
  if (store.kind === 'embedded') {
    return listEmbeddedDatabases(store.dolt_root).map((name) => ({
      dir: path.join(store.dolt_root, name, '.dolt', 'noms'),
      files: [MANIFEST_NAME]
    }));
  }
  if (store.kind === 'server') {
    return [{ dir: store.noms, files: [MANIFEST_NAME, DOLT_JOURNAL_NAME] }];
  }
  return [];
}

/**
 * @param {string} dolt_root
 * @returns {string | null}
 */
function embeddedFingerprint(dolt_root) {
  const hash = crypto.createHash('sha256');
  let found = false;
  for (const name of listEmbeddedDatabases(dolt_root)) {
    const manifest = path.join(dolt_root, name, '.dolt', 'noms', MANIFEST_NAME);
    try {
      const content = fs.readFileSync(manifest);
      hash.update(name).update('\0').update(content).update('\0');
      found = true;
    } catch {
      // database without a manifest yet; skip it
    }
  }
  return found ? hash.digest('hex') : null;
}

/**
 * @param {string} noms
 * @param {boolean} settle
 * @returns {string | null}
 */
function serverFingerprint(noms, settle) {
  try {
    const journal = fs.statSync(path.join(noms, DOLT_JOURNAL_NAME), {
      bigint: true
    });
    if (settle && Date.now() - Number(journal.mtimeMs) < JOURNAL_SETTLE_MS) {
      return null;
    }
    const manifest = fs.readFileSync(path.join(noms, MANIFEST_NAME));
    return crypto
      .createHash('sha256')
      .update(`${journal.ino}\0${journal.size}\0${journal.mtimeNs}\0`)
      .update(manifest)
      .digest('hex');
  } catch {
    // no journal or manifest to read; the data may have changed
    return null;
  }
}

/**
 * Embedded database names, sorted.
 *
 * @param {string} dolt_root
 * @returns {string[]}
 */
function listEmbeddedDatabases(dolt_root) {
  try {
    return fs
      .readdirSync(dolt_root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve the store bd reads from the nearest metadata.json and `env`.
 *
 * Embedded needs metadata.json to parse, name no mode other than `embedded`
 * and no server host, and no server variable to be set. Server needs mode
 * `server`, a loopback `dolt_server_host`, a plain `dolt_database`, a data dir
 * (`BDUI_DOLT_DATA_DIR`, default `DEFAULT_DOLT_DATA_DIR`) whose running server
 * listens on `dolt_server_port`, and that database's noms directory below it.
 * Anything else is none: no file is known to change
 * with the data.
 *
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {DoltStore}
 */
function resolveDoltStore(cwd, env) {
  const metadata_path = findNearestBeadsMetadata(cwd);
  if (!metadata_path || hasServerEnv(env)) {
    return { kind: 'none' };
  }
  const meta = readMetadata(metadata_path);
  if (!meta) {
    return { kind: 'none' };
  }
  const mode = meta.dolt_mode;
  const host = meta.dolt_server_host;
  if ((mode === undefined || mode === 'embedded') && host === undefined) {
    return {
      kind: 'embedded',
      dolt_root: path.join(path.dirname(metadata_path), 'embeddeddolt')
    };
  }
  const name = meta.dolt_database;
  if (
    mode !== 'server' ||
    typeof host !== 'string' ||
    !isLoopback(host) ||
    typeof name !== 'string' ||
    !DATABASE_NAME.test(name)
  ) {
    return { kind: 'none' };
  }
  const data_dir = env.BDUI_DOLT_DATA_DIR || DEFAULT_DOLT_DATA_DIR;
  if (readServerPort(data_dir) !== String(meta.dolt_server_port)) {
    return { kind: 'none' };
  }
  const noms = path.join(data_dir, name, '.dolt', 'noms');
  return isDirectory(noms) ? { kind: 'server', noms } : { kind: 'none' };
}

/**
 * Port of the Dolt server running on a data dir, from its sql-server.info.
 *
 * @param {string} data_dir
 * @returns {string | null} The port, or null when no server info is readable.
 */
function readServerPort(data_dir) {
  try {
    const info = fs.readFileSync(path.join(data_dir, SERVER_INFO_PATH), 'utf8');
    const port = info.trim().split(':')[1];
    return port ? port : null;
  } catch {
    return null;
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function hasServerEnv(env) {
  return Object.keys(env).some(
    (name) =>
      Boolean(env[name]) &&
      (name.startsWith(SERVER_ENV_PREFIX) || SERVER_ENV_NAMES.includes(name))
  );
}

/**
 * @param {string} metadata_path
 * @returns {Record<string, unknown> | null} The parsed object, or null.
 */
function readMetadata(metadata_path) {
  /** @type {unknown} */
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metadata_path, 'utf8'));
  } catch {
    return null;
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (meta);
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLoopback(host) {
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
