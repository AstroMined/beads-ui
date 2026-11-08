import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findNearestBeadsMetadata } from './db.js';

/**
 * Content fingerprint of the embedded Dolt manifests of a workspace.
 *
 * A read-only bd call rewrites a manifest's mtime but not its content, while
 * every bd write changes it (`manifest_probe` in
 * `server/fixtures/bd-ready-parity.json`). Equal fingerprints therefore mean
 * the bead data has not changed.
 *
 * @param {string} cwd - Workspace directory (or any directory below it).
 * @returns {string | null} Hex digest, or null when the workspace has no
 * embedded Dolt manifest (callers must then treat data as changed).
 */
export function readManifestFingerprint(cwd) {
  const metadata_path = findNearestBeadsMetadata(cwd);
  if (!metadata_path) {
    return null;
  }
  const dolt_root = path.join(path.dirname(metadata_path), 'embeddeddolt');
  /** @type {string[]} */
  let db_names;
  try {
    db_names = fs
      .readdirSync(dolt_root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return null;
  }
  const hash = crypto.createHash('sha256');
  let found = false;
  for (const name of db_names) {
    const manifest = path.join(dolt_root, name, '.dolt', 'noms', 'manifest');
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
