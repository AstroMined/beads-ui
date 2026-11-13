import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findNearestBeadsMetadata } from './db.js';

/**
 * Environment variables through which bd reaches a Dolt server instead of the
 * embedded store. Any of them set means the embedded manifests are not the
 * data bd reads.
 */
const SERVER_ENV_PREFIX = 'BEADS_DOLT_SERVER_';
const SERVER_ENV_NAMES = Object.freeze([
  'BEADS_DOLT_SHARED_SERVER',
  'BEADS_DOLT_PROXIED_SERVER',
  'BEADS_DOLT_PORT'
]);

/**
 * Content fingerprint of the embedded Dolt manifests of a workspace.
 *
 * A read-only bd call rewrites a manifest's mtime but not its content, while
 * every bd write changes it (`manifest_probe` in
 * `server/fixtures/bd-ready-parity.json`). Equal fingerprints therefore mean
 * the bead data has not changed.
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @param {NodeJS.ProcessEnv} [env] - Environment bd runs with.
 * @returns {string | null} Hex digest, or null when the workspace has no
 * embedded Dolt manifest or bd does not read the embedded store (callers must
 * then treat data as changed).
 */
export function readManifestFingerprint(cwd, env = process.env) {
  const hash = crypto.createHash('sha256');
  let found = false;
  for (const { name, manifest } of listManifestPaths(cwd, env)) {
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
 * Manifest paths of the embedded Dolt databases of a workspace, sorted by
 * database name. A path is listed even when its manifest does not exist yet.
 * None is listed unless bd reads the embedded store (`isEmbeddedStore`).
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @param {NodeJS.ProcessEnv} [env] - Environment bd runs with.
 * @returns {{ name: string, manifest: string }[]}
 */
export function listManifestPaths(cwd, env = process.env) {
  const metadata_path = findNearestBeadsMetadata(cwd);
  if (!metadata_path || !isEmbeddedStore(metadata_path, env)) {
    return [];
  }
  const dolt_root = path.join(path.dirname(metadata_path), 'embeddeddolt');
  try {
    return fs
      .readdirSync(dolt_root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .map((name) => ({
        name,
        manifest: path.join(dolt_root, name, '.dolt', 'noms', 'manifest')
      }));
  } catch {
    return [];
  }
}

/**
 * Whether bd reads the embedded Dolt store of a workspace: metadata.json
 * parses, names no mode other than `embedded` and no server host, and no
 * server variable is set. Anything else (server mode, an unreadable file) is
 * not embedded, so its manifests prove nothing about the data.
 *
 * @param {string} metadata_path
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function isEmbeddedStore(metadata_path, env) {
  const server_env = Object.keys(env).some(
    (name) =>
      Boolean(env[name]) &&
      (name.startsWith(SERVER_ENV_PREFIX) || SERVER_ENV_NAMES.includes(name))
  );
  if (server_env) {
    return false;
  }
  /** @type {unknown} */
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metadata_path, 'utf8'));
  } catch {
    return false;
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return false;
  }
  const record = /** @type {Record<string, unknown>} */ (meta);
  const mode = record.dolt_mode;
  return (
    (mode === undefined || mode === 'embedded') &&
    record.dolt_server_host === undefined
  );
}
