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
 * Validate that a column definition has all required fields with correct types.
 *
 * @param {unknown} col
 * @returns {col is ColumnDefinition}
 */
function validateColumnDef(col) {
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
    const raw = /** @type {unknown[]} */ (/** @type {any} */ (user.board).columns);
    const valid = raw.filter((col) => {
      if (!validateColumnDef(col)) {
        log('rejected invalid column definition: %o', col);
        return false;
      }
      return true;
    });
    columns = valid.length > 0 ? /** @type {ColumnDefinition[]} */ (valid) : DEFAULT_SETTINGS.board.columns;
  }

  return {
    server: {
      ...DEFAULT_SETTINGS.server,
      .../** @type {Record<string, unknown>} */ (user.server || {})
    },
    board: { columns },
    discovery: {
      ...DEFAULT_SETTINGS.discovery,
      .../** @type {Record<string, unknown>} */ (user.discovery || {})
    }
  };
}
