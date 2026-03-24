import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debug } from './logging.js';

const log = debug('settings');

/**
 * @typedef {Object} ColumnDefinition
 * @property {string} id - Unique column identifier.
 * @property {string} label - Display label for the column header.
 * @property {string} subscription - Subscription type for data (e.g., 'blocked-issues').
 * @property {Record<string, unknown>} [params] - Optional subscription parameters.
 * @property {string} drop_status - Status to set when a card is dropped into this column.
 */

/**
 * @typedef {Object} SettingsObject
 * @property {{ port: number, host: string }} server - Server configuration.
 * @property {{ columns: ColumnDefinition[] }} board - Board layout configuration.
 * @property {{ scan_roots: string[], scan_depth: number }} discovery - Auto-discovery configuration.
 */

/** @type {ColumnDefinition[]} */
const DEFAULT_COLUMNS = [
  {
    id: 'blocked',
    label: 'Blocked',
    subscription: 'blocked-issues',
    drop_status: 'open'
  },
  {
    id: 'ready',
    label: 'Ready',
    subscription: 'ready-issues',
    drop_status: 'open'
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    subscription: 'in-progress-issues',
    drop_status: 'in_progress'
  },
  {
    id: 'closed',
    label: 'Closed',
    subscription: 'closed-issues',
    drop_status: 'closed'
  }
];

/** @type {SettingsObject} */
export const DEFAULT_SETTINGS = {
  server: { port: 3000, host: '127.0.0.1' },
  board: { columns: DEFAULT_COLUMNS },
  discovery: { scan_roots: [], scan_depth: 2 }
};

const SETTINGS_PATH = path.join(os.homedir(), '.beads', 'config.json');

/** @type {SettingsObject} */
let cached = structuredClone(DEFAULT_SETTINGS);

/**
 * Load settings from ~/.beads/config.json.
 * Falls back to DEFAULT_SETTINGS on missing or corrupt file.
 *
 * @returns {SettingsObject}
 */
export function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cached = mergeDefaults(parsed);
    log('loaded settings from %s', SETTINGS_PATH);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      log('warning: failed to parse settings file, using defaults: %o', err);
    }
    cached = structuredClone(DEFAULT_SETTINGS);
  }
  return cached;
}

/**
 * Return the current cached settings object.
 *
 * @returns {SettingsObject}
 */
export function getSettings() {
  return structuredClone(cached);
}

/**
 * Watch ~/.beads/config.json for changes and invoke callback with new settings.
 * Follows the registry-watcher.js pattern with debounce.
 *
 * @param {(settings: SettingsObject) => void} onChange
 * @param {{ debounce_ms?: number }} [options]
 * @returns {{ close: () => void }}
 */
export function watchSettings(onChange, options = {}) {
  const debounce_ms = options.debounce_ms ?? 500;
  const settings_dir = path.dirname(SETTINGS_PATH);
  const settings_file = path.basename(SETTINGS_PATH);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {fs.FSWatcher | undefined} */
  let watcher;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      try {
        // Change detection via JSON.stringify is key-order dependent: reordering
        // keys in the JSON file without changing values will not trigger a change
        // event. This is acceptable for the settings use case.
        const previous = JSON.stringify(cached);
        loadSettings();
        if (JSON.stringify(cached) !== previous) {
          onChange(cached);
        }
      } catch (err) {
        log('error reading settings on change: %o', err);
      }
    }, debounce_ms);
    timer.unref?.();
  };

  try {
    if (!fs.existsSync(settings_dir)) {
      log('settings directory does not exist: %s', settings_dir);
      return { close() {} };
    }

    // persistent:true keeps the Node.js process alive, which is intentional
    // for a long-running server that should not exit when idle.
    watcher = fs.watch(
      settings_dir,
      { persistent: true },
      (event_type, filename) => {
        if (filename && String(filename) !== settings_file) {
          return;
        }
        if (event_type === 'change' || event_type === 'rename') {
          log('settings %s %s', event_type, filename || '');
          schedule();
        }
      }
    );
  } catch (err) {
    log('unable to watch settings directory: %o', err);
    return { close() {} };
  }

  return {
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher?.close();
    }
  };
}

/**
 * Load project-specific settings from <workspace_root>/.beads/config.json.
 * Returns validated SettingsObject with only board.columns populated, or null
 * if file is missing or invalid.
 *
 * @param {string} workspace_root
 * @returns {SettingsObject | null}
 */
export function loadProjectSettings(workspace_root) {
  const project_path = path.join(workspace_root, '.beads', 'config.json');
  try {
    const raw = fs.readFileSync(project_path, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(/** @type {any} */ (parsed.board)?.columns)
    ) {
      return null;
    }
    const raw_columns = /** @type {unknown[]} */ (
      /** @type {any} */ (parsed.board).columns
    );
    const valid = raw_columns.filter((col) => {
      if (!validateColumnDef(col)) {
        log('rejected invalid project column definition: %o', col);
        return false;
      }
      return true;
    });
    if (valid.length === 0) {
      return null;
    }
    return {
      server: DEFAULT_SETTINGS.server,
      board: { columns: /** @type {ColumnDefinition[]} */ (valid) },
      discovery: DEFAULT_SETTINGS.discovery
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      log(
        'warning: failed to parse project settings file %s: %o',
        project_path,
        err
      );
    }
    return null;
  }
}

/**
 * Get effective settings by merging project overrides onto global settings.
 * Project board.columns replace global board.columns entirely (atomic replacement).
 *
 * @param {string} workspace_root
 * @returns {SettingsObject}
 */
export function getEffectiveSettings(workspace_root) {
  const global_settings = getSettings();
  const project_settings = loadProjectSettings(workspace_root);
  if (project_settings && project_settings.board.columns.length > 0) {
    global_settings.board.columns = project_settings.board.columns;
  }
  return structuredClone(global_settings);
}

/**
 * Watch <workspace_root>/.beads/ directory for changes and invoke callback
 * with new project settings. 500ms debounce, same pattern as watchSettings().
 *
 * @param {string} workspace_root
 * @param {(settings: SettingsObject | null) => void} onChange
 * @param {{ debounce_ms?: number }} [options]
 * @returns {{ close: () => void }}
 */
export function watchProjectSettings(workspace_root, onChange, options = {}) {
  const debounce_ms = options.debounce_ms ?? 500;
  const watch_dir = path.join(workspace_root, '.beads');
  const watch_file = 'config.json';

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {fs.FSWatcher | undefined} */
  let watcher;
  let previous_json = JSON.stringify(loadProjectSettings(workspace_root));

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      try {
        const new_settings = loadProjectSettings(workspace_root);
        const new_json = JSON.stringify(new_settings);
        if (new_json !== previous_json) {
          previous_json = new_json;
          onChange(new_settings);
        }
      } catch (err) {
        log('error reading project settings on change: %o', err);
      }
    }, debounce_ms);
    timer.unref?.();
  };

  try {
    if (!fs.existsSync(watch_dir)) {
      log('project settings directory does not exist: %s', watch_dir);
      return { close() {} };
    }

    watcher = fs.watch(
      watch_dir,
      { persistent: true },
      (event_type, filename) => {
        if (filename && String(filename) !== watch_file) {
          return;
        }
        if (event_type === 'change' || event_type === 'rename') {
          log('project settings %s %s', event_type, filename || '');
          schedule();
        }
      }
    );
  } catch (err) {
    log('unable to watch project settings directory: %o', err);
    return { close() {} };
  }

  return {
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      watcher?.close();
    }
  };
}

/**
 * Validate that a column definition has all required fields with correct types.
 *
 * @param {unknown} col
 * @returns {col is ColumnDefinition}
 */
export function validateColumnDef(col) {
  if (!col || typeof col !== 'object') {
    return false;
  }
  const c = /** @type {Record<string, unknown>} */ (col);
  return (
    typeof c.id === 'string' &&
    c.id.length > 0 &&
    typeof c.label === 'string' &&
    c.label.length > 0 &&
    typeof c.subscription === 'string' &&
    c.subscription.length > 0 &&
    typeof c.drop_status === 'string' &&
    c.drop_status.length > 0
  );
}

/**
 * Deep-merge user settings over defaults so missing keys fall back gracefully.
 *
 * @param {Record<string, unknown>} user
 * @returns {SettingsObject}
 */
function mergeDefaults(user) {
  let columns = DEFAULT_SETTINGS.board.columns;
  if (Array.isArray(/** @type {any} */ (user.board)?.columns)) {
    const raw = /** @type {unknown[]} */ (
      /** @type {any} */ (user.board).columns
    );
    const valid = raw.filter((col) => {
      if (!validateColumnDef(col)) {
        log('rejected invalid column definition: %o', col);
        return false;
      }
      return true;
    });
    columns =
      valid.length > 0
        ? /** @type {ColumnDefinition[]} */ (valid)
        : DEFAULT_SETTINGS.board.columns;
  }

  const userServer = /** @type {Record<string, unknown>} */ (user.server || {});
  const serverOverrides = { ...userServer };
  if ('port' in serverOverrides) {
    const p = serverOverrides.port;
    if (
      !Number.isInteger(p) ||
      /** @type {number} */ (p) < 1 ||
      /** @type {number} */ (p) > 65535
    ) {
      log('rejected invalid port value, using default: %o', p);
      delete serverOverrides.port;
    }
  }
  if ('host' in serverOverrides) {
    if (
      typeof serverOverrides.host !== 'string' ||
      serverOverrides.host.length === 0
    ) {
      log(
        'rejected invalid host value, using default: %o',
        serverOverrides.host
      );
      delete serverOverrides.host;
    }
  }

  const userDiscovery = /** @type {Record<string, unknown>} */ (
    user.discovery || {}
  );
  const discoveryOverrides = { ...userDiscovery };
  if ('scan_roots' in discoveryOverrides) {
    const roots = discoveryOverrides.scan_roots;
    if (Array.isArray(roots)) {
      const valid = roots.filter((r) => typeof r === 'string' && r.length > 0);
      if (valid.length > 0) {
        discoveryOverrides.scan_roots = valid;
      } else {
        log('rejected empty scan_roots after filtering, using default');
        delete discoveryOverrides.scan_roots;
      }
    } else {
      log(
        'rejected invalid scan_roots (not an array), using default: %o',
        roots
      );
      delete discoveryOverrides.scan_roots;
    }
  }
  if ('scan_depth' in discoveryOverrides) {
    const d = discoveryOverrides.scan_depth;
    if (!Number.isInteger(d) || /** @type {number} */ (d) <= 0) {
      log('rejected invalid scan_depth, using default: %o', d);
      delete discoveryOverrides.scan_depth;
    }
  }

  return {
    server: {
      ...DEFAULT_SETTINGS.server,
      .../** @type {Record<string, unknown>} */ (serverOverrides)
    },
    board: { columns },
    discovery: {
      ...DEFAULT_SETTINGS.discovery,
      .../** @type {Record<string, unknown>} */ (discoveryOverrides)
    }
  };
}
