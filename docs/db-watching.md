# DB Watching and Resolution

The server watches the active beads SQLite database file for changes and
schedules a refresh of active list subscriptions. Clients receive
`snapshot`/`upsert`/`delete` envelopes for their active subscriptions.

## Resolution Order

The DB path is resolved to match beads CLI precedence:

1. `--db <path>` flag (when forced by the server configuration)
2. `BEADS_DB` environment variable
3. Nearest `.beads/*.db` by walking up from the server `root_dir`
4. `~/.beads/default.db` fallback

The resolved path is injected into all `bd` CLI invocations via `--db` to ensure
the watcher and CLI operate on the same database.

## Behavior When Missing

If no database exists at the resolved path (e.g., before `bd init`), the server
will still attempt to bind a watcher on the containing directory and log a clear
warning. Initialize a database with one of:

- `bd --db /path/to/file.db init`
- `export BEADS_DB=/path/to/file.db && bd init`
- `bd init` in a workspace with a `.beads/` directory

After initialization, changes will be detected without restarting the server.
The watcher can rebind when the workspace or configuration changes at runtime.

## Dolt backends

For a Dolt workspace the server watches the `.beads` directory and the files a
write changes, and skips a refresh while the store's fingerprint is unchanged.
Which files those are depends on `.beads/metadata.json`:

- **Embedded** (no `dolt_mode`, or `embedded`, and no `dolt_server_host`): the
  manifest of each database under `.beads/embeddeddolt/<db>/.dolt/noms`. The
  fingerprint is the manifests' content.
- **Server** (`dolt_mode: "server"` with a loopback `dolt_server_host`): the
  manifest and chunk journal of `<data dir>/<dolt_database>/.dolt/noms`, where
  the data dir is `BDUI_DOLT_DATA_DIR` (default `~/.local/share/bd-server`) and
  its `.dolt/sql-server.info` must name `dolt_server_port`, so a second server
  on another port with the same database names is never mistaken for it. The
  fingerprint is the journal's inode, size and mtime plus the manifest. It reads
  as changed while the journal was written in the last 2 seconds.
- **Anything else** (a remote host, another server's port, a data dir without
  the database, a `BEADS_DOLT_SERVER_*`, `BEADS_DOLT_SHARED_SERVER`,
  `BEADS_DOLT_PROXIED_SERVER` or `BEADS_DOLT_PORT` variable, or a metadata file
  that does not parse): no fingerprint, so every watcher event refreshes the
  lists.

A change to `metadata.json` re-targets the watched files, as does any `.beads`
event while no store file is watched. A change seen during the cooldown after a
refresh is deferred to the cooldown's end and fires then only when the store
files moved since that refresh, so bd reads that touch a watched file never
chain refreshes.
