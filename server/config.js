import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from './settings.js';

/**
 * Resolve runtime configuration for the server.
 * Precedence: CLI flags > env vars > settings file > defaults.
 *
 * Notes:
 * - `app_dir` is resolved relative to the installed package location.
 * - `root_dir` represents the directory where the process was invoked
 * (i.e., the current working directory) so DB resolution follows the
 * caller's context rather than the install location.
 *
 * @param {import('./settings.js').SettingsObject} [settings] - Optional settings override (defaults to getSettings()).
 * @returns {{ host: string, port: number, app_dir: string, root_dir: string, url: string }}
 */
// CLI flag precedence is achieved via process.env mutation in server/index.js
// (lines 22-29), where --host and --port argv values are written to process.env
// before getConfig() is called. The precedence chain is:
// CLI flags (via env mutation) > pre-existing env vars > settings file > defaults.
export function getConfig(settings) {
  const s = settings || getSettings();
  const this_file = fileURLToPath(new URL(import.meta.url));
  const server_dir = path.dirname(this_file);
  const package_root = path.resolve(server_dir, '..');
  // Always reflect the directory from which the process was started
  const root_dir = process.cwd();

  // Port: env var > settings > default (3000)
  let port_value = Number.parseInt(process.env.PORT || '', 10);
  if (!Number.isFinite(port_value)) {
    port_value = s.server.port;
  }

  // Host: env var > settings > default (127.0.0.1)
  const host_env = process.env.HOST;
  const host_value = host_env && host_env.length > 0 ? host_env : s.server.host;

  return {
    host: host_value,
    port: port_value,
    app_dir: path.resolve(package_root, 'app'),
    root_dir,
    url: `http://${host_value}:${port_value}`
  };
}
