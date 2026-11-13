import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceDatabase } from './db.js';
import { listStoreWatchTargets, readStoreSignature } from './dolt-manifest.js';
import { debug } from './logging.js';

/** Workspace metadata file whose change can switch the Dolt store. */
const METADATA_NAME = 'metadata.json';

/**
 * Watch the resolved workspace database target and invoke a callback after a
 * debounce window.
 *
 * For SQLite workspaces this watches the DB file's parent directory and filters
 * by file name. For non-SQLite backends (for example Dolt), this watches the
 * workspace `.beads` directory. The files a Dolt store write changes are
 * watched as well (`listStoreWatchTargets`): an embedded manifest sits below
 * `.beads` where a non-recursive watch does not see it, and a Dolt server
 * writes to its own data directory. A `metadata.json` change re-targets them,
 * since it can switch the store, and so does any `.beads` event while no store
 * file is watched. A change seen during the cooldown after a refresh is
 * deferred to the cooldown's end and fires then only if the store signature
 * moved since that refresh: bd reads that touch a watched file (such as a
 * manifest mtime) never chain into another refresh.
 *
 * @param {string} root_dir - Project root directory (starting point for resolution).
 * @param {() => void} onChange - Called when changes are detected.
 * @param {{ debounce_ms?: number, cooldown_ms?: number, explicit_db?: string }} [options]
 * @returns {{ close: () => void, rebind: (opts?: { root_dir?: string, explicit_db?: string }) => void, path: string }}
 */
export function watchDb(root_dir, onChange, options = {}) {
  const debounce_ms = options.debounce_ms ?? 250;
  const cooldown_ms = options.cooldown_ms ?? 1000;
  const log = debug('watcher');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {fs.FSWatcher | undefined} */
  let watcher;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let deferred;
  /** @type {fs.FSWatcher[]} */
  let store_watchers = [];
  let cooldown_until = 0;
  /** @type {string | null} */
  let fired_signature = null;
  let current_root = root_dir;
  let current_path = '';
  let current_dir = '';
  let current_file = '';

  /**
   * Schedule the debounced onChange callback.
   */
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fired_signature = readStoreSignature(current_root);
      onChange();
      cooldown_until = Date.now() + cooldown_ms;
    }, debounce_ms);
    timer.unref();
  };

  /**
   * @param {string} event_type
   * @param {string} filename - Name logged with the event.
   */
  const onEvent = (event_type, filename) => {
    if (event_type !== 'change' && event_type !== 'rename') {
      return;
    }
    const wait = cooldown_until - Date.now();
    if (wait > 0) {
      if (!deferred) {
        deferred = setTimeout(() => {
          deferred = undefined;
          const signature = readStoreSignature(current_root);
          if (signature !== null && signature !== fired_signature) {
            log('store changed during cooldown');
            schedule();
          }
        }, wait);
        deferred.unref();
      }
      return;
    }
    log('fs %s %s', event_type, filename);
    schedule();
  };

  /**
   * Watch the files a Dolt store write changes.
   *
   * @param {string} base_dir
   */
  const bindStore = (base_dir) => {
    for (const { dir, files } of listStoreWatchTargets(base_dir)) {
      try {
        store_watchers.push(
          fs.watch(dir, { persistent: true }, (event_type, filename) => {
            if (filename && files.includes(String(filename))) {
              onEvent(event_type, path.join(dir, String(filename)));
            }
          })
        );
      } catch (err) {
        log('unable to watch store directory %s %o', dir, err);
      }
    }
  };

  const closeStoreWatchers = () => {
    for (const w of store_watchers) {
      w.close();
    }
    store_watchers = [];
  };

  /**
   * Attach a watcher to the directory containing the resolved DB path.
   *
   * @param {string} base_dir
   * @param {string | undefined} explicit_db
   */
  const bind = (base_dir, explicit_db) => {
    current_root = base_dir;
    const resolved = resolveWorkspaceDatabase({ cwd: base_dir, explicit_db });
    current_path = resolved.path;
    if (pathIsDirectory(current_path)) {
      current_dir = current_path;
      current_file = '';
    } else {
      current_dir = path.dirname(current_path);
      current_file = path.basename(current_path);
    }
    if (!resolved.exists) {
      log(
        'resolved workspace database missing: %s – Hint: set --db, export BEADS_DB, or run `bd init` in your workspace.',
        current_path
      );
    }

    // (Re)create watcher
    try {
      watcher = fs.watch(
        current_dir,
        { persistent: true },
        (event_type, filename) => {
          if (
            (filename && String(filename) === METADATA_NAME) ||
            store_watchers.length === 0
          ) {
            closeStoreWatchers();
            bindStore(base_dir);
          }
          if (current_file && filename && String(filename) !== current_file) {
            return;
          }
          onEvent(event_type, filename ? String(filename) : '');
        }
      );
    } catch (err) {
      log('unable to watch directory %s %o', current_dir, err);
    }

    bindStore(base_dir);
  };

  const closeWatchers = () => {
    watcher?.close();
    closeStoreWatchers();
  };

  // initial bind
  bind(root_dir, options.explicit_db);

  return {
    get path() {
      return current_path;
    },
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (deferred) {
        clearTimeout(deferred);
        deferred = undefined;
      }
      closeWatchers();
    },
    /**
     * Re-resolve and reattach watcher when root_dir or explicit_db changes.
     *
     * @param {{ root_dir?: string, explicit_db?: string }} [opts]
     */
    rebind(opts = {}) {
      const next_root = opts.root_dir ? String(opts.root_dir) : root_dir;
      const next_explicit = opts.explicit_db ?? options.explicit_db;
      const next_resolved = resolveWorkspaceDatabase({
        cwd: next_root,
        explicit_db: next_explicit
      });
      const next_path = next_resolved.path;
      if (next_path !== current_path) {
        // swap watcher
        closeWatchers();
        if (deferred) {
          clearTimeout(deferred);
          deferred = undefined;
        }
        cooldown_until = 0;
        bind(next_root, next_explicit);
      }
    }
  };
}

/**
 * @param {string} file_path
 */
function pathIsDirectory(file_path) {
  try {
    return fs.statSync(file_path).isDirectory();
  } catch {
    return false;
  }
}
