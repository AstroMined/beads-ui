import fs from 'node:fs';
import path from 'node:path';
import { debug } from './logging.js';

const log = debug('discovery');

/**
 * Directories to skip during recursive scanning.
 *
 * @type {Set<string>}
 */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Check whether a directory name should be skipped during scanning.
 * Skips node_modules, .git, and hidden directories (starting with '.').
 *
 * @param {string} name
 * @returns {boolean}
 */
function shouldSkip(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

/**
 * Check whether a directory contains a .beads/ subdirectory with database
 * files (*.db) or a metadata.json file.
 *
 * @param {string} dir - Absolute path to check.
 * @returns {Promise<boolean>}
 */
async function hasBeadsProject(dir) {
  const beads_dir = path.join(dir, '.beads');
  try {
    const entries = await fs.promises.readdir(beads_dir, {
      withFileTypes: true
    });
    return entries.some(
      (e) =>
        e.isFile() && (e.name.endsWith('.db') || e.name === 'metadata.json')
    );
  } catch {
    return false;
  }
}

/**
 * Recursively scan a single root directory for .beads/ projects.
 *
 * @param {string} dir - Absolute path to scan.
 * @param {number} depth - Remaining recursion depth.
 * @param {Array<{ workspace_path: string, name: string }>} results - Accumulator.
 */
async function walkDir(dir, depth, results) {
  if (depth < 0) {
    return;
  }

  if (await hasBeadsProject(dir)) {
    results.push({
      workspace_path: dir,
      name: path.basename(dir)
    });
  }

  if (depth === 0) {
    return;
  }

  /** @type {fs.Dirent[]} */
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      log('skipping symlink: %s', path.join(dir, entry.name));
      continue;
    }
    if (entry.isDirectory() && !shouldSkip(entry.name)) {
      await walkDir(path.join(dir, entry.name), depth - 1, results);
    }
  }
}

/**
 * Scan configured root directories for projects containing a .beads/ database.
 *
 * @param {string[]} roots - Directories to scan.
 * @param {number} depth - Maximum recursion depth (e.g., 2 means children and grandchildren).
 * @returns {Promise<Array<{ workspace_path: string, name: string }>>}
 */
export async function scanForWorkspaces(roots, depth) {
  /** @type {Array<{ workspace_path: string, name: string }>} */
  const results = [];

  for (const root of roots) {
    const resolved = path.resolve(root);
    log('scanning %s (depth=%d)', resolved, depth);

    try {
      await fs.promises.readdir(resolved);
    } catch {
      log('root does not exist or is not readable: %s', resolved);
      continue;
    }

    await walkDir(resolved, depth, results);
  }

  log('found %d workspace(s)', results.length);
  return results;
}
