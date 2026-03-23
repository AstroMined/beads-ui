import { createServer } from 'node:http';
import { createApp } from './app.js';
import { printServerUrl } from './cli/daemon.js';
import { getConfig } from './config.js';
import { resolveWorkspaceDatabase } from './db.js';
import { scanForWorkspaces } from './discovery.js';
import { debug, enableAllDebug } from './logging.js';
import {
  getAvailableWorkspaces,
  registerWorkspace,
  watchRegistry
} from './registry-watcher.js';
import { loadSettings, watchSettings } from './settings.js';
import { watchDb } from './watcher.js';
import { attachWsServer } from './ws.js';

if (process.argv.includes('--debug') || process.argv.includes('-d')) {
  enableAllDebug();
}

// Parse --host and --port from argv and set env vars before getConfig()
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--host' && process.argv[i + 1]) {
    process.env.HOST = process.argv[++i];
  }
  if (process.argv[i] === '--port' && process.argv[i + 1]) {
    process.env.PORT = process.argv[++i];
  }
}

// Load settings from ~/.beads/config.json before config resolution
const settings = loadSettings();
const config = getConfig(settings);
const app = createApp(config);
const server = createServer(app);
const log = debug('server');

// Register the initial workspace (from cwd) so it appears in the workspace picker
// even without the beads daemon running
const workspace_database = resolveWorkspaceDatabase({ cwd: config.root_dir });
if (workspace_database.source !== 'home-default' && workspace_database.exists) {
  registerWorkspace({
    path: config.root_dir,
    database: workspace_database.path
  });
}

// Auto-discover workspaces from configured scan roots
const scan_roots = settings.discovery.scan_roots || [];
if (scan_roots.length > 0) {
  const scan_depth = settings.discovery.scan_depth ?? 2;
  const discovered = scanForWorkspaces(scan_roots, scan_depth);
  const existing = getAvailableWorkspaces();
  const existing_paths = new Set(existing.map((w) => w.path));
  let registered = 0;
  for (const ws of discovered) {
    if (!existing_paths.has(ws.workspace_path)) {
      registerWorkspace({ path: ws.workspace_path, database: '' });
      registered++;
    }
  }
  log('discovered %d workspaces from %d roots, registered %d new', discovered.length, scan_roots.length, registered);
} else {
  log('no discovery scan roots configured, skipping workspace scan');
}

// Watch the active beads DB and schedule subscription refresh for active lists
const db_watcher = watchDb(config.root_dir, () => {
  // Schedule subscription list refresh run for active subscriptions
  log('db change detected → schedule refresh');
  scheduleListRefresh();
  // v2: all updates flow via subscription push envelopes only
});

const { scheduleListRefresh, broadcastSettingsChanged } = attachWsServer(
  server,
  {
    path: '/ws',
    heartbeat_ms: 30000,
    // Coalesce DB change bursts into one refresh run
    refresh_debounce_ms: 75,
    root_dir: config.root_dir,
    watcher: db_watcher
  }
);

// Track previous discovery settings for change comparison
let prev_scan_roots = JSON.stringify(settings.discovery.scan_roots || []);
let prev_scan_depth = settings.discovery.scan_depth ?? 2;

// Watch settings file for changes and push to connected clients
watchSettings((new_settings) => {
  log('settings changed, broadcasting to clients');
  broadcastSettingsChanged(new_settings);

  // Re-scan if discovery settings changed
  const new_roots = new_settings.discovery?.scan_roots || [];
  const new_depth = new_settings.discovery?.scan_depth ?? 2;
  const new_roots_str = JSON.stringify(new_roots);
  if (new_roots_str !== prev_scan_roots || new_depth !== prev_scan_depth) {
    prev_scan_roots = new_roots_str;
    prev_scan_depth = new_depth;
    if (new_roots.length > 0) {
      log('re-scanning workspaces: roots=%o depth=%d', new_roots, new_depth);
      const discovered = scanForWorkspaces(new_roots, new_depth);
      const existing = getAvailableWorkspaces();
      const existing_paths = new Set(existing.map((w) => w.path));
      let re_registered = 0;
      for (const ws of discovered) {
        if (!existing_paths.has(ws.workspace_path)) {
          registerWorkspace({ path: ws.workspace_path, database: '' });
          re_registered++;
        }
      }
      log('re-scan found %d workspaces, registered %d new', discovered.length, re_registered);
    }
  }
});

// Watch the global registry for workspace changes (e.g., when user starts
// bd daemon in a different project). This enables automatic workspace switching.
watchRegistry(
  (entries) => {
    log('registry changed: %d entries', entries.length);
    // Find if there's a newer workspace that matches our initial root
    // For now, we just log the change - users can switch via set-workspace
    // Future: could auto-switch if a workspace was started in a parent/child dir
  },
  { debounce_ms: 500 }
);

server.listen(config.port, config.host, () => {
  printServerUrl();
});

server.on('error', (err) => {
  log('server error %o', err);
  process.exitCode = 1;
});
