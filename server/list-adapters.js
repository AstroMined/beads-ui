/**
 * @import { DepIssue } from '../app/data/dep-graph.js'
 * @import { GraphEdge } from '../types/subscriptions.js'
 */
import { deriveBdBlocked, deriveBdReadyIds } from '../app/data/dep-graph.js';
import { GRAPH_ISSUES_TYPE } from '../app/data/graph-subscription.js';
import { shouldDeriveReady } from './bd-version.js';
import { runBdJson } from './bd.js';
import { readManifestFingerprint } from './dolt-manifest.js';
import { debug } from './logging.js';

const log = debug('list-adapters');

/** Row cap for bd list commands whose result is bounded by a status. */
export const BD_LIST_LIMIT = 1000;

/** bd's `--limit` value for "no cap" (bd defaults to 50 rows). */
export const BD_LIST_UNLIMITED = 0;

/**
 * Scalar fields `graph-issues` keeps from a bd row. `dependencies` is always
 * added, reduced to deduplicated `{ depends_on_id, type }` edges.
 */
export const GRAPH_ISSUE_FIELDS = Object.freeze([
  'id',
  'title',
  'status',
  'priority',
  'issue_type',
  'assignee',
  'parent',
  'labels',
  'created_at',
  'updated_at',
  'closed_at'
]);

/** Most ids one `bd show` call resolves for the closed-id resolver. */
export const CLOSED_ID_BATCH_MAX = 100;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Server-side floor for `closed-issues`: the widest Closed column filter the
 * board offers ('7' days in `app/views/board.js`). The client keeps its finer
 * filter on top.
 */
const CLOSED_FLOOR_DAYS = 7;

/** Status served by `in-progress-issues`, filtered from the open set. */
const IN_PROGRESS_STATUS = 'in_progress';

/** Prefix of cross-project refs, which bd never resolves to a bead. */
const EXTERNAL_REF_PREFIX = 'external:';

/** Status of a deleted bead that bd may still report. */
const TOMBSTONE_STATUS = 'tombstone';

/**
 * bd's error when none of the ids given to `bd show` exist: stderr
 * `no issue found matching ...` or the JSON `error`
 * `no issues found matching the provided IDs`.
 */
const BD_NOT_FOUND_PATTERN = /no issues? found matching/i;

/**
 * The open set: every non-closed, non-pinned bead (see `rules.open_set` in
 * `server/fixtures/bd-ready-parity.json`).
 */
const OPEN_SET_ARGS = Object.freeze([
  'list',
  '--json',
  '--tree=false',
  '--limit',
  String(BD_LIST_UNLIMITED)
]);

/**
 * Types served from the shared open set. `all-issues` runs the same command,
 * so it shares the spawn too.
 */
const OPEN_SET_TYPES = new Set([
  'all-issues',
  GRAPH_ISSUES_TYPE,
  'in-progress-issues'
]);

/** Types derived from the open set when the bd version allows it. */
const DERIVED_TYPES = new Set(['ready-issues', 'blocked-issues']);

/**
 * Extra attempts (after the first) for read-only list fetches. A transient
 * `bd` failure - for example an embedded-Dolt error when a read overlaps a
 * concurrent `bd` writer, or a truncated read that fails JSON parsing - is
 * safe to retry because list fetches are idempotent. Overridable with the
 * `BDUI_BD_LIST_RETRIES` environment variable (a non-negative integer).
 *
 * @type {number}
 */
const DEFAULT_LIST_FETCH_RETRIES = 2;

/**
 * Backoff in milliseconds before retry N (0-indexed). If more retries are
 * configured than this table has entries, the last value is reused.
 *
 * @type {number[]}
 */
const LIST_FETCH_BACKOFF_MS = [100, 250];

/**
 * Resolve the configured number of list-fetch retries from the environment,
 * falling back to the default when unset or invalid.
 *
 * @returns {number}
 */
function resolveListFetchRetries() {
  const raw = process.env.BDUI_BD_LIST_RETRIES;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_LIST_FETCH_RETRIES;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    return DEFAULT_LIST_FETCH_RETRIES;
  }
  return n;
}

/**
 * Resolve after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run a read-only `bd --json` list command with bounded retries so a momentary
 * failure self-heals instead of surfacing a permanent board error. A genuinely
 * persistent failure is returned unchanged after the final attempt, so the
 * caller's existing error handling still applies.
 *
 * @param {string[]} args
 * @param {{ cwd?: string }} options
 * @returns {Promise<{ code: number, stdoutJson?: unknown, stderr?: string }>}
 */
async function runBdJsonWithRetry(args, options) {
  const retries = resolveListFetchRetries();
  /** @type {{ code: number, stdoutJson?: unknown, stderr?: string }} */
  let res = { code: -1, stderr: 'bd not run' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    res = await runBdJson(args, { cwd: options.cwd });
    const failed = !res || res.code !== 0 || !('stdoutJson' in res);
    if (!failed || attempt === retries) {
      return res;
    }
    const backoff =
      LIST_FETCH_BACKOFF_MS[
        Math.min(attempt, LIST_FETCH_BACKOFF_MS.length - 1)
      ];
    log(
      'bd list attempt %d/%d failed (code=%s); retrying in %dms',
      attempt + 1,
      retries + 1,
      res?.code,
      backoff
    );
    await delay(backoff);
  }
  return res;
}

/**
 * A bd JSON row. Ids are coerced to strings by `normalizeIssueList`.
 *
 * @typedef {Record<string, unknown>} BdRow
 */

/**
 * A `graph-issues` row: the `GRAPH_ISSUE_FIELDS` a bd row carries plus its
 * reduced dependency edges.
 *
 * @typedef {{ id: string, dependencies: GraphEdge[] } & Record<string, unknown>} GraphRow
 */

/**
 * Build concrete `bd` CLI args for a subscription type + params.
 * Always includes `--json` for parseable output. For `ready-issues` and
 * `blocked-issues` these are the fallback commands, spawned only when the
 * workspace's bd version does not allow deriving them from the open set.
 *
 * @param {{ type: string, params?: Record<string, string | number | boolean> }} spec
 * @returns {string[]}
 */
export function mapSubscriptionToBdArgs(spec) {
  const t = String(spec.type);
  switch (t) {
    case 'all-issues':
    case GRAPH_ISSUES_TYPE:
    case 'in-progress-issues': {
      return OPEN_SET_ARGS.slice();
    }
    case 'epics': {
      return ['epic', 'status', '--json'];
    }
    case 'blocked-issues': {
      return ['blocked', '--json'];
    }
    case 'ready-issues': {
      return ['ready', '--limit', String(BD_LIST_LIMIT), '--json'];
    }
    case 'closed-issues': {
      const floor = new Date(Date.now() - CLOSED_FLOOR_DAYS * MS_PER_DAY);
      return [
        'list',
        '--json',
        '--tree=false',
        '--status',
        'closed',
        '--closed-after',
        floor.toISOString(),
        '--limit',
        String(BD_LIST_LIMIT)
      ];
    }
    case 'status-issues': {
      const status = String((spec.params || {}).status || '').trim();
      if (status.length === 0) {
        throw badRequest('Missing param: params.status');
      }
      return [
        'list',
        '--json',
        '--tree=false',
        '--status',
        status,
        '--limit',
        String(BD_LIST_LIMIT)
      ];
    }
    case 'issue-detail': {
      const p = spec.params || {};
      const id = String(p.id || '').trim();
      if (id.length === 0) {
        throw badRequest('Missing param: params.id');
      }
      return ['show', id, '--json'];
    }
    default: {
      throw badRequest(`Unknown subscription type: ${t}`);
    }
  }
}

/**
 * Normalize bd list output to minimal Issue shape used by the registry.
 * - Ensures `id` is a string.
 * - Coerces timestamps to numbers.
 * - `closed_at` defaults to null when missing or invalid.
 *
 * @param {unknown} value
 * @returns {Array<{ id: string, created_at: number, updated_at: number, closed_at: number | null } & Record<string, unknown>>}
 */
export function normalizeIssueList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Array<{ id: string, created_at: number, updated_at: number, closed_at: number | null } & Record<string, unknown>>} */
  const out = [];
  for (const it of value) {
    const id = String(it.id ?? '');
    if (id.length === 0) {
      continue;
    }
    const created_at = parseTimestamp(/** @type {any} */ (it).created_at);
    const updated_at = parseTimestamp(it.updated_at);
    const closed_raw = it.closed_at;
    /** @type {number | null} */
    let closed_at = null;
    if (closed_raw !== undefined && closed_raw !== null) {
      const n = parseTimestamp(closed_raw);
      closed_at = Number.isFinite(n) ? n : null;
    }
    out.push({
      ...it,
      id,
      created_at: Number.isFinite(created_at) ? created_at : 0,
      updated_at: Number.isFinite(updated_at) ? updated_at : 0,
      closed_at
    });
  }
  return out;
}

/**
 * Whether a bd row is a live bead: not tombstoned and not soft-deleted.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLiveIssue(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = /** @type {{ status?: unknown, deleted_at?: unknown }} */ (value);
  if (row.status === TOMBSTONE_STATUS) {
    return false;
  }
  return row.deleted_at === undefined || row.deleted_at === null;
}

/**
 * Reduce dependency edges, in the list shape (`depends_on_id`, `type`) or the
 * detail shape (`id`, `dependency_type`), to deduplicated `GraphEdge`s.
 *
 * @param {unknown} value
 * @returns {GraphEdge[]}
 */
function reduceEdges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {GraphEdge[]} */
  const out = [];
  for (const edge of value) {
    if (!edge || typeof edge !== 'object') {
      continue;
    }
    const target =
      typeof edge.depends_on_id === 'string' && edge.depends_on_id
        ? edge.depends_on_id
        : typeof edge.id === 'string'
          ? edge.id
          : '';
    if (target.length === 0) {
      continue;
    }
    const type =
      typeof edge.type === 'string'
        ? edge.type
        : typeof edge.dependency_type === 'string'
          ? edge.dependency_type
          : '';
    const key = `${target}\n${type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ depends_on_id: target, type });
  }
  return out;
}

/**
 * Project a bd list or show row to the `graph-issues` shape: the
 * `GRAPH_ISSUE_FIELDS` it carries plus deduplicated `{ depends_on_id, type }`
 * dependencies.
 *
 * @param {BdRow} row
 * @returns {GraphRow}
 */
export function projectGraphIssue(row) {
  /** @type {GraphRow} */
  const out = {
    id: String(row.id ?? ''),
    dependencies: reduceEdges(row.dependencies)
  };
  for (const field of GRAPH_ISSUE_FIELDS) {
    if (field !== 'id' && field in row) {
      out[field] = row[field];
    }
  }
  return out;
}

/**
 * @typedef {Object} FetchListResultSuccess
 * @property {true} ok
 * @property {Array<{ id: string, updated_at: number, closed_at: number | null } & Record<string, unknown>>} items
 * @property {true} [partial] - Some rows could not be resolved and are
 * retried by the next fetch, so a refresh pass must not count as clean.
 */

/**
 * Options for `fetchListForSubscription`.
 *
 * @typedef {Object} FetchListOptions
 * @property {string} [cwd] - Working directory for bd commands.
 * @property {symbol} [pass] - Token of the refresh pass making the call.
 * Callers with the same token share one in-flight open-set spawn even
 * when the workspace has no store fingerprint.
 */

/**
 * @typedef {Object} FetchListResultFailure
 * @property {false} ok
 * @property {{ code: string, message: string, details?: Record<string, unknown> }} error
 */

/**
 * @typedef {{ ok: true, rows: BdRow[] } | FetchListResultFailure} OpenSetResult
 */

/**
 * One open-set fetch per workspace. `fingerprint` is the Dolt store
 * fingerprint read before the spawn; `pass` is the token of the refresh pass
 * that started it, or null outside a pass.
 *
 * @typedef {{ fingerprint: string | null, pass: symbol | null, promise: Promise<OpenSetResult> }} OpenSetEntry
 */

/**
 * Latest open-set fetch per workspace directory. An entry is reused while its
 * fingerprint is unchanged and non-null. With a null fingerprint (no store
 * file known to change with the data) nothing tells a later write apart, so it is shared only
 * with callers of the refresh pass that started it.
 *
 * @type {Map<string, OpenSetEntry>}
 */
const open_set_by_cwd = new Map();

/**
 * Closed-id resolver cache per workspace directory: a projected row for each
 * resolved id outside the open set, or null when bd reported it missing.
 *
 * @type {Map<string, Map<string, GraphRow | null>>}
 */
const outside_rows_by_cwd = new Map();

/**
 * @param {string | undefined} cwd
 * @returns {string}
 */
function workspaceDir(cwd) {
  return cwd || process.cwd();
}

/**
 * Coerce bd JSON output to a list of object rows. `bd show` may return a
 * single object.
 *
 * @param {unknown} value
 * @returns {BdRow[]}
 */
function toRows(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((it) => it !== null && typeof it === 'object');
}

/**
 * The structured failure for a failed bd run, or null when it succeeded.
 *
 * @param {{ code: number, stdoutJson?: unknown, stderr?: string } | undefined} res
 * @returns {FetchListResultFailure | null}
 */
function bdFailure(res) {
  if (res && res.code === 0 && 'stdoutJson' in res) {
    return null;
  }
  return {
    ok: false,
    error: {
      code: 'bd_error',
      message: String(res?.stderr || 'bd failed'),
      details: { exit_code: res?.code ?? -1 }
    }
  };
}

/**
 * The structured failure for a bd invocation that threw.
 *
 * @param {unknown} err
 * @returns {FetchListResultFailure}
 */
function invocationFailure(err) {
  const message =
    err instanceof Error && err.message ? err.message : 'bd invocation failed';
  return { ok: false, error: { code: 'bd_error', message } };
}

/**
 * Spawn the open-set list. Never rejects.
 *
 * @param {string | undefined} cwd
 * @returns {Promise<OpenSetResult>}
 */
async function runOpenSet(cwd) {
  const args = OPEN_SET_ARGS.slice();
  try {
    const res = await runBdJsonWithRetry(args, { cwd });
    const failure = bdFailure(res);
    if (failure) {
      log(
        'bd open set failed (args=%o) code=%s stderr=%s',
        args,
        res?.code,
        res?.stderr || ''
      );
      return failure;
    }
    return { ok: true, rows: toRows(res.stdoutJson).filter(isLiveIssue) };
  } catch (err) {
    log('bd open set invocation failed (args=%o): %o', args, err);
    return invocationFailure(err);
  }
}

/**
 * Whether a caller may reuse an open-set entry. An unchanged non-null
 * fingerprint reuses it, pending or settled. A null fingerprint cannot rule
 * out a write since the spawn read the database, so only callers of the
 * refresh pass that started the spawn reuse it; a write landing during that
 * pass fires the watcher again, and the next pass spawns afresh.
 *
 * @param {OpenSetEntry | undefined} entry
 * @param {string | null} fingerprint
 * @param {symbol | null} pass
 * @returns {entry is OpenSetEntry}
 */
function canReuseOpenSet(entry, fingerprint, pass) {
  if (!entry || entry.fingerprint !== fingerprint) {
    return false;
  }
  if (fingerprint !== null) {
    return true;
  }
  return pass !== null && entry.pass === pass;
}

/**
 * The open set of a workspace, shared by every open-set type in a refresh
 * pass: callers share one in-flight spawn, and an unchanged non-null store
 * fingerprint reuses the last successful rows (see `canReuseOpenSet`).
 * Failures are never reused.
 *
 * @param {string | undefined} cwd
 * @param {symbol | null} pass - Token of the calling refresh pass, or null.
 * @returns {Promise<OpenSetResult>}
 */
function loadOpenSet(cwd, pass) {
  const key = workspaceDir(cwd);
  const fingerprint = readManifestFingerprint(key);
  const entry = open_set_by_cwd.get(key);
  if (canReuseOpenSet(entry, fingerprint, pass)) {
    return entry.promise;
  }
  const promise = runOpenSet(cwd);
  /** @type {OpenSetEntry} */
  const created = { fingerprint, pass, promise };
  open_set_by_cwd.set(key, created);
  promise.then((result) => {
    if (!result.ok && open_set_by_cwd.get(key) === created) {
      open_set_by_cwd.delete(key);
    }
  });
  return promise;
}

/**
 * Ids that open-set rows reference (parents and dependency targets of any
 * type) but that are not in the open set. External refs are skipped.
 *
 * @param {GraphRow[]} rows
 * @param {Set<string>} open_ids
 * @returns {string[]} Sorted ids.
 */
function referencedOutsideIds(rows, open_ids) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @param {unknown} id */
  const add = (id) => {
    if (
      typeof id === 'string' &&
      id.length > 0 &&
      !open_ids.has(id) &&
      !id.startsWith(EXTERNAL_REF_PREFIX)
    ) {
      ids.add(id);
    }
  };
  for (const row of rows) {
    add(row.parent);
    for (const edge of row.dependencies) {
      add(edge.depends_on_id);
    }
  }
  return Array.from(ids).sort();
}

/**
 * Whether a failed bd run is bd's "no issue found" error.
 *
 * @param {{ code: number, stdoutJson?: unknown, stderr?: string } | undefined} res
 * @returns {boolean}
 */
function isBdNotFound(res) {
  const json = /** @type {{ error?: unknown } | null | undefined} */ (
    res?.stdoutJson
  );
  const json_error =
    json && typeof json === 'object' && typeof json.error === 'string'
      ? json.error
      : '';
  return (
    BD_NOT_FOUND_PATTERN.test(String(res?.stderr || '')) ||
    BD_NOT_FOUND_PATTERN.test(json_error)
  );
}

/**
 * Resolve one batch of ids with `bd show`. A missing id is cached as null; a
 * batch whose ids are all missing fails in bd with its not-found error, so
 * then the whole batch is cached as null too. Any other failure leaves the
 * batch uncached, so the next fetch retries it.
 *
 * @param {Map<string, GraphRow | null>} cache
 * @param {string[]} ids
 * @param {string | undefined} cwd
 * @returns {Promise<boolean>} False when the batch was left unresolved.
 */
async function resolveOutsideBatch(cache, ids, cwd) {
  const args = ['show', ...ids, '--json'];
  const res = await runBdJsonWithRetry(args, { cwd });
  if (bdFailure(res)) {
    if (!isBdNotFound(res)) {
      log('bd show failed for %d ids (code=%s)', ids.length, res?.code);
      return false;
    }
  } else {
    const wanted = new Set(ids);
    for (const row of toRows(res.stdoutJson)) {
      const id = String(row.id ?? '');
      if (wanted.has(id) && isLiveIssue(row)) {
        cache.set(id, projectGraphIssue(row));
      }
    }
  }
  for (const id of ids) {
    if (!cache.has(id)) {
      cache.set(id, null);
    }
  }
  return true;
}

/**
 * Rows for the ids open-set rows reference outside the open set, such as a
 * closed parent or a closed blocker, each with its real status. Ids are
 * resolved once through batched `bd show` calls and cached; an id is dropped
 * from the cache when it reappears in the open set.
 *
 * @param {GraphRow[]} open_rows - Projected open set.
 * @param {string | undefined} cwd
 * @returns {Promise<{ rows: GraphRow[], complete: boolean }>} `complete` is
 * false when a batch failed and its ids are left for the next fetch.
 */
async function resolveOutsideRows(open_rows, cwd) {
  const key = workspaceDir(cwd);
  let cache = outside_rows_by_cwd.get(key);
  if (!cache) {
    cache = new Map();
    outside_rows_by_cwd.set(key, cache);
  }
  const open_ids = new Set(open_rows.map((row) => row.id));
  for (const id of open_ids) {
    cache.delete(id);
  }
  const referenced = referencedOutsideIds(open_rows, open_ids);
  const missing = referenced.filter((id) => !cache.has(id));
  let complete = true;
  for (let i = 0; i < missing.length; i += CLOSED_ID_BATCH_MAX) {
    const resolved = await resolveOutsideBatch(
      cache,
      missing.slice(i, i + CLOSED_ID_BATCH_MAX),
      cwd
    );
    complete = complete && resolved;
  }
  /** @type {GraphRow[]} */
  const rows = [];
  for (const id of referenced) {
    const row = cache.get(id);
    if (row) {
      rows.push(row);
    }
  }
  return { rows, complete };
}

/**
 * Serve an open-set type: `graph-issues` (projected rows plus resolved rows
 * outside the open set), `in-progress-issues` (a status filter, which
 * matches bd exactly) or `all-issues` (the rows unchanged).
 *
 * @param {string} type
 * @param {string | undefined} cwd
 * @param {symbol | null} pass
 * @returns {Promise<FetchListResultSuccess | FetchListResultFailure>}
 */
async function fetchFromOpenSet(type, cwd, pass) {
  const open = await loadOpenSet(cwd, pass);
  if (!open.ok) {
    return open;
  }
  if (type === GRAPH_ISSUES_TYPE) {
    const projected = open.rows.map(projectGraphIssue);
    const outside = await resolveOutsideRows(projected, cwd);
    const items = normalizeIssueList([...projected, ...outside.rows]);
    return outside.complete
      ? { ok: true, items }
      : { ok: true, items, partial: true };
  }
  if (type === 'in-progress-issues') {
    const rows = open.rows.filter((row) => row.status === IN_PROGRESS_STATUS);
    return { ok: true, items: normalizeIssueList(rows) };
  }
  return { ok: true, items: normalizeIssueList(open.rows) };
}

/**
 * Derive `ready-issues` or `blocked-issues` from the open set with the bd
 * 0.63.3 rules in `app/data/dep-graph.js`. Rows keep bd's full list fields;
 * ready rows keep the open-set order (the board sorts them), and blocked rows
 * are sorted by id and carry `blocked_by` and `blocked_by_count` like
 * `bd blocked --json`.
 *
 * @param {string} type
 * @param {string | undefined} cwd
 * @param {symbol | null} pass
 * @returns {Promise<FetchListResultSuccess | FetchListResultFailure>}
 */
async function fetchDerived(type, cwd, pass) {
  const open = await loadOpenSet(cwd, pass);
  if (!open.ok) {
    return open;
  }
  // bd list rows carry the DepIssue fields; extra fields are ignored.
  const issues = /** @type {DepIssue[]} */ (open.rows);
  if (type === 'ready-issues') {
    const ready = new Set(deriveBdReadyIds(issues, Date.now()));
    const rows = open.rows.filter((row) => ready.has(String(row.id ?? '')));
    return { ok: true, items: normalizeIssueList(rows) };
  }
  /** @type {Map<string, BdRow>} */
  const by_id = new Map();
  for (const row of open.rows) {
    by_id.set(String(row.id ?? ''), row);
  }
  const rows = deriveBdBlocked(issues).map((blocked) => ({
    ...by_id.get(blocked.id),
    id: blocked.id,
    blocked_by: blocked.blocked_by,
    blocked_by_count: blocked.blocked_by.length
  }));
  return { ok: true, items: normalizeIssueList(rows) };
}

/**
 * Execute the mapped `bd` command for a subscription spec and return normalized items.
 * Open-set types share one `bd list` spawn per refresh pass; `ready-issues`
 * and `blocked-issues` are derived from it when the bd version allows.
 * Errors do not throw; they are surfaced as a structured object.
 *
 * @param {{ type: string, params?: Record<string, string | number | boolean> }} spec
 * @param {FetchListOptions} [options]
 * @returns {Promise<FetchListResultSuccess | FetchListResultFailure>}
 */
export async function fetchListForSubscription(spec, options = {}) {
  const type = String(spec.type);
  const pass = options.pass ?? null;
  /** @type {string[]} */
  let args;
  try {
    args = mapSubscriptionToBdArgs(spec);
  } catch (err) {
    // Surface bad requests (e.g., missing params)
    log('mapSubscriptionToBdArgs failed for %o: %o', spec, err);
    const e = toErrorObject(err);
    return { ok: false, error: e };
  }

  try {
    if (OPEN_SET_TYPES.has(type)) {
      return await fetchFromOpenSet(type, options.cwd, pass);
    }
    if (
      DERIVED_TYPES.has(type) &&
      (await shouldDeriveReady(workspaceDir(options.cwd)))
    ) {
      return await fetchDerived(type, options.cwd, pass);
    }
    const res = await runBdJsonWithRetry(args, { cwd: options.cwd });
    const failure = bdFailure(res);
    if (failure) {
      log(
        'bd failed for %o (args=%o) code=%s stderr=%s',
        spec,
        args,
        res?.code,
        res?.stderr || ''
      );
      return failure;
    }
    let raw = toRows(res.stdoutJson);

    // Special-case mapping for `epics`: current bd output nests the epic under
    // an `epic` key and exposes counters at the top level. Flatten so that
    // each entry has a top-level `id` and core fields expected by the registry.
    if (type === 'epics') {
      raw = raw.map((it) => {
        if (it && typeof it === 'object' && 'epic' in it) {
          const e = /** @type {any} */ (it).epic || {};
          /** @type {Record<string, unknown>} */
          const flat = {
            // Required minimal fields for registry + client rendering
            id: String(e.id ?? ''),
            title: e.title,
            status: e.status,
            issue_type: e.issue_type || 'epic',
            created_at: e.created_at,
            updated_at: e.updated_at,
            closed_at: e.closed_at ?? null,
            deleted_at: e.deleted_at ?? null,
            // Preserve useful counters from bd output
            total_children: /** @type {any} */ (it).total_children,
            closed_children: /** @type {any} */ (it).closed_children,
            eligible_for_close: /** @type {any} */ (it).eligible_for_close
          };
          return flat;
        }
        return it;
      });
      raw = raw.filter(isLiveIssue);
    }

    const items = normalizeIssueList(raw);
    return { ok: true, items };
  } catch (err) {
    log('bd invocation failed for %o (args=%o): %o', spec, args, err);
    return invocationFailure(err);
  }
}

/**
 * Create a `bad_request` error object.
 *
 * @param {string} message
 */
function badRequest(message) {
  const e = new Error(message);
  // @ts-expect-error add code
  e.code = 'bad_request';
  return e;
}

/**
 * Normalize arbitrary thrown values to a structured error object.
 *
 * @param {unknown} err
 * @returns {FetchListResultFailure['error']}
 */
function toErrorObject(err) {
  if (err && typeof err === 'object') {
    const any = /** @type {{ code?: unknown, message?: unknown }} */ (err);
    const code = typeof any.code === 'string' ? any.code : 'bad_request';
    const message =
      typeof any.message === 'string' ? any.message : 'Request error';
    return { code, message };
  }
  return { code: 'bad_request', message: 'Request error' };
}

/**
 * Parse a bd timestamp string to epoch ms using Date.parse.
 * Falls back to numeric coercion when parsing fails.
 *
 * @param {unknown} v
 * @returns {number}
 */
function parseTimestamp(v) {
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) {
      return ms;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}
