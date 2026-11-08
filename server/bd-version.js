import { runBd } from './bd.js';
import { debug } from './logging.js';

const log = debug('bd-version');

/**
 * The bd release whose `bd ready` and `bd blocked` rules
 * `app/data/dep-graph.js` reproduces (`server/fixtures/bd-ready-parity.json`).
 * Any other version spawns `bd ready` and `bd blocked` instead, so a bd
 * upgrade cannot silently change the board.
 */
export const DERIVED_READY_BD_VERSION = '0.63.3';

/** First `major.minor.patch` in `bd --version` output. */
const SEMVER_PATTERN = /\b(\d+\.\d+\.\d+)\b/;

/**
 * Memoized `bd --version` reads, keyed by workspace directory.
 *
 * @type {Map<string, Promise<string | null>>}
 */
const version_by_cwd = new Map();

/**
 * Workspaces whose version mismatch was already logged.
 *
 * @type {Set<string>}
 */
const mismatch_logged = new Set();

/**
 * Extract the semver from `bd --version` output such as
 * `bd version 0.63.3 (c08f18a4)`.
 *
 * @param {string} output
 * @returns {string | null}
 */
export function parseBdVersion(output) {
  const match = SEMVER_PATTERN.exec(String(output || ''));
  return match ? match[1] : null;
}

/**
 * Run `bd --version` in `cwd`. Failures resolve to null.
 *
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function readBdVersion(cwd) {
  try {
    const res = await runBd(['--version'], { cwd });
    if (!res || res.code !== 0) {
      log('bd --version failed in %s (code=%s)', cwd, res?.code);
      return null;
    }
    return parseBdVersion(res.stdout);
  } catch (err) {
    log('bd --version threw in %s: %o', cwd, err);
    return null;
  }
}

/**
 * The bd version for a workspace, read once per `cwd`. A failed read is not
 * memoized, so the next call tries again.
 *
 * @param {string} cwd - Workspace directory.
 * @returns {Promise<string | null>} Semver such as `0.63.3`, or null.
 */
export function getBdVersion(cwd) {
  const existing = version_by_cwd.get(cwd);
  if (existing) {
    return existing;
  }
  const promise = readBdVersion(cwd);
  version_by_cwd.set(cwd, promise);
  promise.then((version) => {
    if (version === null && version_by_cwd.get(cwd) === promise) {
      version_by_cwd.delete(cwd);
    }
  });
  return promise;
}

/**
 * Whether `ready-issues` and `blocked-issues` may be derived from the open
 * set: true only when the workspace's bd is exactly
 * `DERIVED_READY_BD_VERSION`. A mismatch is logged once per workspace.
 *
 * @param {string} cwd - Workspace directory.
 * @returns {Promise<boolean>}
 */
export async function shouldDeriveReady(cwd) {
  const version = await getBdVersion(cwd);
  if (version === DERIVED_READY_BD_VERSION) {
    return true;
  }
  if (!mismatch_logged.has(cwd)) {
    mismatch_logged.add(cwd);
    log(
      'bd version %s in %s is not %s; spawning bd ready and bd blocked',
      version ?? 'unknown',
      cwd,
      DERIVED_READY_BD_VERSION
    );
  }
  return false;
}
