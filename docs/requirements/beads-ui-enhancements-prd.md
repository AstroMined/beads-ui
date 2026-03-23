# beads-ui Enhancements PRD

**Status:** Complete **Date:** 2026-03-23 (Phase 0 completed 2026-03-22, Phase 1
completed 2026-03-23, Phase 2 completed 2026-03-22, Phase 3 completed
2026-03-23, Phase R4 completed 2026-03-23, R5 completed 2026-03-23) **Author:**
Ryan Peterson **Related:**
[mantoni/beads-ui](https://github.com/mantoni/beads-ui) (upstream)

> **Review Round 1**: 40 findings (1 critical, 4 major, 3 high, 8 medium, 7
> minor, 8 low, 9 informational) across 4 remediation phases **Completion**: 35
> of 35 requirements implemented (100%) **Epics**: beads-ui-w49.1,
> beads-ui-w49.2, beads-ui-w49.3, beads-ui-w49.4

## Context

The beads-ui Kanban board currently displays a fixed set of four columns
(Blocked, Ready, In Progress, Closed) with no ability to customize the layout,
filter issues, or discover projects automatically. This rigidity conflicts with
workflows that require custom statuses like `in_review`, makes it difficult to
focus on specific epics or assignees, and forces users to manually start the
server in each project directory to switch between workspaces.

Today, the board columns are hardcoded in `app/views/board.js` via a
`COLUMN_STATUS_MAP` object. Card titles are truncated with CSS
`text-overflow: ellipsis` at column width, hiding important context. Server
configuration relies solely on environment variables and CLI flags with no
persistent settings file. Project discovery walks up the directory tree from CWD
to find the nearest `.beads/` database, requiring a separate server start per
project.

These limitations slow down the prepare-feature through finalize-feature
pipeline workflow, where an `in_review` status is needed but invisible on the
board. The immediate motivation is enabling this workflow, but the broader goal
is making beads-ui more customizable and user-friendly without a dramatic
architectural overhaul, just extending current functionality.

## Current State Analysis

### Codebase Landscape

- **Runtime**: Node.js >= 22, ESM modules throughout
- **Server**: Express 4.x HTTP + ws WebSocket library, push-based subscription
  model
- **Client**: lit-html templates, simple store-based state management
  (`createStore`)
- **Build**: esbuild (ESM, es2020 target) | **Test**: vitest (dual node/jsdom) |
  **Lint**: eslint + prettier
- **Key deps**: express, ws, lit-html, marked, dompurify, debug
- **Commands**: `npm test`, `npm run tsc`, `npm run lint`,
  `npm run prettier:check`

### Relevant Modules

| Module           | Path                             | Current Responsibility                                            |
| ---------------- | -------------------------------- | ----------------------------------------------------------------- |
| Board view       | `app/views/board.js` (724 lines) | Hardcoded 4-column Kanban with drag-drop, keyboard nav            |
| Server config    | `server/config.js`               | Resolves port/host from env vars, derives app_dir/root_dir        |
| DB resolver      | `server/db.js`                   | Walks UP from CWD to find `.beads/*.db` or `metadata.json`        |
| List adapters    | `server/list-adapters.js`        | Maps subscription types to `bd` CLI args (switch statement)       |
| Validators       | `server/validators.js`           | Allowlist of valid subscription types (`SUBSCRIPTION_TYPES` Set)  |
| Registry watcher | `server/registry-watcher.js`     | Watches `~/.beads/registry.json`, manages workspace list          |
| WebSocket server | `server/ws.js` (1349 lines)      | Handles subscriptions, mutations, workspace switching             |
| App state        | `app/state.js`                   | Store with `{ view, filters, board, workspace }`                  |
| List selectors   | `app/data/list-selectors.js`     | Client-side sorting/selection for board columns                   |
| Bootstrap        | `app/main.js`                    | SPA shell, `ensureTabSubscriptions()` manages board subscriptions |
| Protocol         | `app/protocol.js`                | Message type definitions for WebSocket protocol                   |
| Styles           | `app/styles.css`                 | Board grid at lines 1207-1335, `.text-truncate` at line 396       |

### Existing Patterns

- **Subscription model**: Each board column is a separate WebSocket subscription
  backed by a `bd` CLI command. The server caches results, computes deltas
  (snapshot/upsert/delete), and pushes updates. New columns must follow this
  pattern.
- **State management**: Simple `createStore()` with `subscribe()` callbacks. No
  framework, no reducers. Board state is composed from multiple subscription
  stores in `refreshFromStores()`.
- **Config precedence**: CLI flags override env vars. No settings file exists
  yet.
- **File watching**: `server/watcher.js` watches DB files with debounce (75ms)
  and cooldown (1000ms). `server/registry-watcher.js` watches
  `~/.beads/registry.json` with 500ms debounce. New file watchers should follow
  these patterns.
- **Persistence**: Client preferences in localStorage (`beads-ui.*` keys).
  Server has no persistence beyond the workspace registry file.
- **bd CLI execution**: Serialized through a promise queue in `server/bd.js` to
  prevent Dolt concurrency crashes. All new bd invocations must go through
  `runBd()`/`runBdJson()`.

### Integration Points

| Point                       | Description                                                        | Affected By                   |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| `COLUMN_STATUS_MAP`         | Hardcoded column-to-status mapping in board.js                     | Configurable columns          |
| `ensureTabSubscriptions()`  | Bootstrap function in main.js creating 4 fixed board subscriptions | Configurable columns          |
| `SUBSCRIPTION_TYPES` Set    | Allowlist in validators.js controlling valid subscription types    | Custom status subscription    |
| `mapSubscriptionToBdArgs()` | Switch statement in list-adapters.js mapping types to bd args      | Custom status subscription    |
| `update-status` handler     | ws.js validates against `['open', 'in_progress', 'closed']` Set    | Drag-drop with custom columns |
| `getAvailableWorkspaces()`  | Merges file + in-memory registries                                 | Project discovery             |
| `getConfig()`               | Returns `{ host, port, app_dir, root_dir, url }`                   | Settings engine               |

### External Research Insights

No external web research was performed for this PRD. The features are
well-understood UI patterns (configurable Kanban, filtering, settings
persistence, directory scanning) that do not require external validation. The
implementation is grounded entirely in codebase analysis and user requirements.

## Decisions Made

| Decision                      | Choice                                          | Rationale                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column model                  | Arbitrary status mapping                        | Each column maps to a bd subscription type + optional params. Enables custom statuses like `in_review` without being limited to the 3 core statuses. Default config reproduces current 4-column behavior exactly.                 |
| Settings file location        | `~/.beads/config.json`                          | Co-located with `registry.json` and `default.db` that already live in `~/.beads/`. Works on Linux and macOS (both resolve `~` correctly). Avoids creating a new directory.                                                        |
| Settings API                  | Read-only WebSocket endpoint                    | Server exposes `get-settings` message type; file is edited manually. Avoids concurrency risks of write endpoints. Watcher detects changes and pushes `settings-changed` events.                                                   |
| Project discovery             | Registry + directory scan hybrid                | Read `~/.beads/registry.json` for known workspaces AND scan configured root directories. Auto-register discoveries in registry. Fast for known projects, discovers new ones too.                                                  |
| Scan depth                    | Configurable, default 2                         | Covers flat repos + one level of org grouping without excessive scanning. Users can override in settings.                                                                                                                         |
| Title wrapping                | Full wrap, no line clamp                        | Cards vary in height but show complete titles. Flexbox column layout already handles variable-height children.                                                                                                                    |
| Filtering approach            | Client-side                                     | Issue data already includes `assignee`, `issue_type`, and `parent` fields. Scale is hundreds of issues, not thousands. Client-side filtering is simpler and more responsive than server-side. Follows existing list view pattern. |
| Filterable fields             | Parent/Epic, Assignee, Type                     | Labels excluded from initial scope (lower priority). These three cover the primary workflow needs.                                                                                                                                |
| Drag-drop with custom columns | `drop_status` field per column                  | Each column definition includes a `drop_status` mapping to a real bd status (`open`, `in_progress`, `closed`). The `update-status` handler remains unchanged. Custom columns control which bd status a dropped card receives.     |
| Config precedence             | CLI flags > env vars > settings file > defaults | Maintains backward compatibility. Existing env var and CLI flag usage continues to work. Settings file adds persistence without breaking existing workflows.                                                                      |
| Settings hot-reload           | Auto hot-reload board on settings change        | Server pushes `settings-changed` event, client tears down old column subscriptions and rebuilds with new column definitions. More polished UX, justified by the frequency of column config changes during workflow setup.         |
| in_review status              | Already supported in bd CLI                     | The bd CLI accepts custom statuses including `in_review`. No separate bd CLI change needed. The `status-issues` subscription type simply queries `bd list --status in_review`.                                                    |

## Technology Stack

- **Runtime**: Node.js >= 22 (ESM)
- **Server**: Express 4.x, ws library, existing `bd` CLI integration
- **Client**: lit-html (existing), no new framework dependencies
- **Settings**: Plain JSON file (`~/.beads/config.json`), read with
  `fs.readFileSync`, watched with `fs.watch`
- **Directory scanning**: `fs.readdirSync` with `{ withFileTypes: true }`
  (matching existing patterns in `db.js`)
- **Testing**: vitest (existing), dual node/jsdom environments
- **No new dependencies required** for any phase

## Non-Goals

- **Settings UI in the browser** - Settings are edited manually in
  `~/.beads/config.json`. A settings page adds significant complexity for
  minimal benefit given the file is simple JSON. Users comfortable with beads-ui
  are comfortable with a config file.
- **Server-side filtering** - All Kanban filtering happens client-side after
  data arrives from subscriptions. Server-side filtering would require
  parameterized subscription types and duplicate data management for minimal
  performance gain at this scale.
- **New bd CLI statuses** - This PRD does not add new status values to the `bd`
  CLI itself. Custom columns work by creating subscriptions that query existing
  bd commands with different parameters. The `in_review` status must already
  exist in the bd CLI; the UI just needs to display it.
- **Column reordering via drag-drop** - Column order is defined in the settings
  file. Drag-drop reordering adds UI complexity; users edit the JSON array order
  instead.
- **Label-based filtering** - Labels are excluded from the initial filter set.
  Can be added in a future enhancement if needed.
- **Real-time scan watching** - Directory scanning happens on startup and
  settings change, not continuously. New projects created after startup require
  a server restart or settings file touch to be discovered.
- **Multi-user settings** - Settings are per-machine, stored in the user's home
  directory. No per-user profiles or shared settings.
- **Migration from localStorage** - Existing client-side preferences (theme,
  view, filters) remain in localStorage. They are not migrated to the settings
  file.

## Phased Roadmap

### Phase 0: Foundation (Settings Engine + Card Title Fix)

**Depends on:** (none)

- [x] Global settings module (`server/settings.js`) with `loadSettings()`,
      `getSettings()`, `watchSettings(onChange)` functions following the
      `registry-watcher.js` file watching pattern
- [x] Settings JSON schema with typed defaults for `server` (port, host),
      `board.columns` (default 4-column config), and `discovery` (scan_roots,
      scan_depth) sections
- [x] Server config integration in `server/config.js` merging settings file
      values with env var and CLI flag overrides (CLI > env > settings >
      defaults)
- [x] WebSocket `get-settings` message handler in `server/ws.js` returning
      current settings to client, and `settings-changed` push event when file
      changes
- [x] Protocol update in `app/protocol.js` adding `get-settings` and
      `settings-changed` message types
- [x] Card title wrapping fix: remove `text-truncate` class from card title div
      in `app/views/board.js` and add `overflow-wrap: break-word` CSS to
      `.board-card__title` in `app/styles.css`
- [x] Unit tests for settings module (load, defaults, merge, file-not-found
      fallback, watcher)

### Phase 1: Configurable Kanban Columns

**Depends on:** Phase 0 (settings module, get-settings WebSocket message,
board.columns schema)

- [x] Generic `status-issues` subscription type in `server/list-adapters.js`
      that accepts a `status` parameter and maps to
      `bd list --json --tree=false --status <param>`
- [x] Validator update in `server/validators.js` adding `status-issues` to
      `SUBSCRIPTION_TYPES` with param validation requiring non-empty
      `params.status` string
- [x] Board view refactor in `app/views/board.js`: replace hardcoded
      `COLUMN_STATUS_MAP` and four `list_*` variables with dynamic column
      generation from settings, using a `Map<string, IssueLite[]>` keyed by
      column ID
- [x] Dynamic `ensureTabSubscriptions()` in `app/main.js`: iterate over column
      definitions from settings to create subscriptions instead of hardcoded
      four, with full teardown and rebuild on `settings-changed` events
      (hot-reload)
- [x] Dynamic CSS grid in `app/styles.css`: change `.board-root` from
      `repeat(4, 1fr)` to `repeat(var(--board-columns, 4), 1fr)` with
      `overflow-x: auto` for horizontal scrolling when many columns
- [x] Drag-drop status mapping using `drop_status` field from column definition,
      preserving existing `update-status` WebSocket message handler without
      modification
- [x] Preserve existing closed column date filter for columns with
      `subscription: 'closed-issues'`
- [x] Unit tests for `status-issues` adapter, dynamic column rendering, and
      drag-drop with custom drop_status

### Phase 2: Project Auto-Discovery

**Depends on:** Phase 0 (settings module for scan_roots and scan_depth
configuration)

- [x] Discovery module (`server/discovery.js`) with
      `scanForWorkspaces(roots, depth)` that walks directories looking for
      `.beads/` subdirectories containing `*.db` or `metadata.json` files,
      skipping `node_modules`, `.git`, and hidden directories
- [x] Integration into `server/registry-watcher.js`: modify
      `getAvailableWorkspaces()` to merge registry entries with scan results,
      deduplicating by resolved absolute path
- [x] Auto-registration of discovered workspaces in the in-memory registry
      during server startup and when settings change (scan roots or depth
      updated)
- [x] Workspace picker enhancement in `app/views/workspace-picker.js` to show
      project name alongside path for better readability in dropdown
- [x] Unit tests for directory scanning (depth limiting, exclusion patterns,
      deduplication with registry, metadata.json detection)

### Phase 3: Kanban Filters

**Depends on:** Phase 1 (dynamic columns must exist before filtering across
them)

- [x] Filter bar component in `app/views/board.js` rendering above the board
      grid with three `<select>` dropdowns: Parent/Epic, Assignee, and Type
- [x] Dropdown population logic that scans all issues across all column stores
      to extract unique parent, assignee, and issue_type values, sorted
      alphabetically
- [x] Client-side filtering in `refreshFromStores()` applying `Array.filter()`
      to each column's issue list before rendering, with empty filter value
      meaning "show all"
- [x] Board filter state (`board_filters: { parent, assignee, type }`) added to
      `app/state.js` AppState with localStorage persistence following existing
      `beads-ui.board` pattern
- [x] Filter bar styling in `app/styles.css` with flex layout above the board
      grid, matching existing filter UI conventions from the Issues list view
- [x] Unit tests for filter bar rendering, filtering logic (single filter,
      combined filters, empty filters), and dropdown population

## UX / Architecture Details

### Settings File Format

```json
{
  "server": {
    "port": 3000,
    "host": "127.0.0.1"
  },
  "board": {
    "columns": [
      {
        "id": "blocked",
        "label": "Blocked",
        "subscription": "blocked-issues",
        "drop_status": "open"
      },
      {
        "id": "ready",
        "label": "Ready",
        "subscription": "ready-issues",
        "drop_status": "open"
      },
      {
        "id": "in-progress",
        "label": "In Progress",
        "subscription": "in-progress-issues",
        "drop_status": "in_progress"
      },
      {
        "id": "in-review",
        "label": "In Review",
        "subscription": "status-issues",
        "params": { "status": "in_review" },
        "drop_status": "in_progress"
      },
      {
        "id": "closed",
        "label": "Closed",
        "subscription": "closed-issues",
        "drop_status": "closed"
      }
    ]
  },
  "discovery": {
    "scan_roots": ["/code"],
    "scan_depth": 2
  }
}
```

### Column Definition Schema

Each column object in `board.columns`:

| Field          | Type   | Required | Description                                                                                                  |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `id`           | string | Yes      | Unique column identifier, used as CSS class suffix and subscription key                                      |
| `label`        | string | Yes      | Display name in column header                                                                                |
| `subscription` | string | Yes      | Subscription type (`ready-issues`, `blocked-issues`, `in-progress-issues`, `closed-issues`, `status-issues`) |
| `params`       | object | No       | Parameters passed to subscription (e.g., `{ status: 'in_review' }` for `status-issues`)                      |
| `drop_status`  | string | Yes      | bd status value assigned when a card is dropped on this column (`open`, `in_progress`, or `closed`)          |

### WebSocket Messages (New)

**`get-settings` (request/reply)**

```
Request:  { id: "...", type: "get-settings" }
Reply:    { id: "...", ok: true, type: "get-settings", payload: { settings: <SettingsObject> } }
```

**`settings-changed` (server push)**

```
{ id: "...", type: "settings-changed", payload: { settings: <SettingsObject> } }
```

### Filter Bar Layout

```
+---------------------------------------------------------------------+
| [Parent/Epic: All v] [Assignee: All v] [Type: All v]               |
+---------------------------------------------------------------------+
| Blocked (3)    | Ready (5)      | In Progress (2) | In Review (1)  | ...
| +-----------+  | +-----------+  | +-----------+   | +-----------+  |
| | Card      |  | | Card      |  | | Card      |   | | Card      |  |
| | Title     |  | | Title now |  | |           |   | |           |  |
| | wraps     |  | | wraps too |  | +-----------+   | +-----------+  |
| +-----------+  | +-----------+  |                  |                |
```

### Server Startup Flow (Updated)

```
1. loadSettings()                     # Read ~/.beads/config.json (or defaults)
2. getConfig(settings, cli_flags)     # Merge: CLI > env > settings > defaults
3. resolveWorkspaceDatabase()         # Find current workspace DB
4. scanForWorkspaces(roots, depth)    # Scan configured directories
5. registerWorkspace() for each       # Auto-register discoveries
6. watchSettings(onSettingsChange)    # React to config file edits
7. watchDb() + watchRegistry()        # Existing watchers
8. server.listen()                    # Start HTTP + WebSocket
```

## Key Risks and Mitigations

| Risk                                                    | Impact                                       | Mitigation                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backward compatibility break when no config file exists | High - existing users see broken board       | Default settings reproduce exact current 4-column behavior. All code paths handle missing config file gracefully. Extensive test coverage for defaults.                                                                       |
| Board refactor breaks drag-drop or keyboard navigation  | High - core interaction regresses            | The 724-line board.js has established interaction patterns. Refactor preserves all event handlers; only the column generation and data mapping change. Board tests must cover drag-drop with both default and custom columns. |
| `parent` field missing from subscription data           | Medium - parent/epic filter shows no options | Verify that `bd list --json` includes parent field in output. If absent, the filter dropdown will be empty but non-breaking. Can fall back to requiring issue-detail subscriptions.                                           |
| Directory scanning too slow on large trees              | Low - only affects startup time              | Default depth of 2 limits scan scope. Skip `node_modules`, `.git`, hidden dirs. Scan is synchronous but bounded. Users with deep trees can reduce depth in settings.                                                          |
| Settings file corruption (invalid JSON)                 | Medium - server fails to read config         | Wrap JSON.parse in try/catch, log warning, fall back to defaults. Never crash on bad config.                                                                                                                                  |
| Subscription type validation bypass                     | Low - security concern                       | New `status-issues` type validates `params.status` is a non-empty string. bd CLI itself validates status values, providing defense in depth.                                                                                  |

## Verification Plan

### Phase 0

- [x] `npm test` passes with all new settings module tests
- [x] `npm run tsc` reports no type errors in new/modified modules
- [x] Server starts correctly with no `~/.beads/config.json` (defaults used)
- [x] Server starts correctly with a valid `~/.beads/config.json` (settings
      merged)
- [x] `--port` and `--host` CLI flags override settings file values
- [x] Editing `~/.beads/config.json` while server is running triggers
      `settings-changed` WebSocket event
- [x] Board cards display full titles with word wrapping (no truncation)

### Phase 1

- [x] `npm test` passes with all updated board and adapter tests
- [x] Board renders default 4 columns when no custom config exists
- [x] Board renders 5+ columns when config includes custom columns (e.g.,
      `in_review`)
- [x] Dragging a card to a custom column updates its status to the column's
      `drop_status` value
- [x] Board is horizontally scrollable when column count exceeds viewport width
- [x] Closed column date filter still works on closed-type columns
- [x] Keyboard navigation (arrow keys, Enter/Space) works across dynamic columns

### Phase 2

- [x] `npm test` passes with all discovery module tests
- [x] Starting server in `/code/` discovers projects in subdirectories (e.g.,
      beads-ui, skyauto-triage)
- [x] Discovered projects appear in workspace picker
- [x] Switching to a discovered workspace loads its issues correctly
- [x] Projects already in registry.json are not duplicated
- [x] Scan respects depth limit (does not recurse beyond configured depth)

### Phase 3

- [x] `npm test` passes with all filter tests
- [x] Filter bar renders above board with three dropdowns
- [x] Selecting a parent/epic filter shows only cards belonging to that parent
- [x] Selecting an assignee filter shows only cards assigned to that person
- [x] Selecting a type filter shows only cards of that type
- [x] Combining multiple filters applies AND logic (intersection)
- [x] Clearing all filters restores full board view
- [x] Filter selections persist across page reloads (localStorage)

## Phase 0 Outcomes

### What Was Completed

- Settings module (`server/settings.js`) with `loadSettings()`, `getSettings()`,
  `watchSettings()`, `DEFAULT_SETTINGS`, and `mergeDefaults()` implementing the
  full settings engine with file watching and debounce
- Server config integration (`server/config.js`) modified to accept optional
  settings parameter with CLI > env > settings > defaults precedence chain
- WebSocket protocol types (`app/protocol.js`) extended with `get-settings` and
  `settings-changed` message types
- WebSocket handlers (`server/ws.js`) with `get-settings` request handler and
  `broadcastSettingsChanged()` function exposed via `attachWsServer()` return
  value
- Server startup integration (`server/index.js`) wiring `loadSettings()` before
  config, passing settings to `getConfig()`, and connecting `watchSettings()` to
  the broadcast function
- Card title wrapping fix: removed `text-truncate` class from card title div in
  `app/views/board.js` and added `overflow-wrap: break-word` to
  `.board-card__title` in `app/styles.css`
- 17 unit tests in `server/settings.test.js` covering load, defaults, merge,
  malformed JSON, file watcher, debounce, and config integration precedence

### Deviations from Plan

- No deviations. All deliverables implemented as specified.

### Key Patterns Established

- **Settings file**: `~/.beads/config.json` (co-located with existing
  `registry.json` and `default.db`)
- **Settings API**: `loadSettings()` reads and caches, `getSettings()` returns
  cached, `watchSettings(onChange)` watches for changes with 500ms debounce
- **Merge strategy**: Deep merge with `mergeDefaults()` - missing keys fall back
  to defaults, custom `board.columns` arrays replace defaults entirely (not
  merged per-element)
- **WebSocket pattern**: Read-only `get-settings` handler follows existing
  request/reply pattern; `broadcastSettingsChanged()` uses existing
  `broadcast()` helper for server push
- **Test pattern**: Module-level `vi.mock('node:fs')` with `freshImport()` for
  state reset between tests, `vi.useFakeTimers()` for debounce testing

## Phase 1 Outcomes

### What Was Completed

- Generic `status-issues` subscription type in `server/list-adapters.js` with
  `params.status` parameter mapping to
  `bd list --json --tree=false --status <param>`
- Validator update in `server/validators.js` adding `status-issues` to
  `SUBSCRIPTION_TYPES` with non-empty `params.status` string validation
- Board view refactor in `app/views/board.js`: replaced hardcoded
  `COLUMN_STATUS_MAP` and four `list_*` variables with dynamic `ColumnDef[]`
  array, `column_data` Map and `column_raw` Map keyed by column ID, and
  `col_defs.map()` rendering in `template()`
- Dynamic `ensureTabSubscriptions()` in `app/main.js`: replaced 4 hardcoded
  `unsub_board_*` variables and ~100 lines of subscription blocks with
  `unsub_board_map` Map and a ~25 line loop over `board_columns` array
- Settings hot-reload in `app/main.js`: `settings-changed` event handler with
  full teardown (unsubscribe, unregister stores) and rebuild (new board_view,
  re-subscribe, re-load)
- Dynamic CSS grid in `app/styles.css`: `repeat(var(--board-columns, 4), 1fr)`
  with `overflow-x: auto` for horizontal scrolling
- Drag-drop using `col_defs.find()` with `drop_status` field from column
  definition; existing `update-status` WebSocket handler unchanged
- Closed column date filter preserved for columns with
  `subscription: 'closed-issues'` via dynamic `column_raw` Map and
  `applyClosedFilter()` iterating `col_defs`
- 12 unit tests: 5 validator tests (`server/validators.test.js`), 3 list-adapter
  tests (`server/list-adapters.test.js`), 4 board tests
  (`app/views/board.test.js`) covering 5-column rendering, drop_status dispatch,
  closed filter scoping, and keyboard navigation across dynamic columns

### Deviations from Plan

- Tasks .2.4 (rendering), .2.8 (drag-drop), and .2.9 (closed filter) were
  naturally coupled with the board data model refactor in .2.3 and were
  implemented together in a single commit rather than as separate changes. This
  was the correct decomposition since these concerns were tightly interleaved in
  the original `board.js` code.

### Key Patterns Established

- **ColumnDef type**: `{id, label, subscription, params?, drop_status}` drives
  all board behavior from column rendering to subscription setup to drag-drop
  status mapping
- **Dynamic Maps**: `column_data` and `column_raw` Maps keyed by column ID
  replace all hardcoded list variables
- **Ready-excludes-in-progress**: When refreshing from stores, in-progress
  column IDs are collected first, then used to filter ready columns. This
  pattern is preserved in the dynamic model.
- **CSS variable binding**: `--board-columns` CSS var set via inline `style`
  attribute on `.board-root` for grid column count
- **Settings bootstrap**: `get-settings` fetch in `app/main.js` initializes
  `board_columns` before first subscription setup; `settings-changed` event
  triggers full teardown/rebuild cycle

## Phase 2 Outcomes

### What Was Completed

- Discovery module (`server/discovery.js`) with
  `scanForWorkspaces(roots, depth)` using recursive `fs.readdirSync` with
  `{ withFileTypes: true }`, skipping `node_modules`, `.git`, and hidden
  directories, detecting `.beads/` subdirectories containing `*.db` or
  `metadata.json`
- Registry integration (`server/registry-watcher.js`) with
  `getAvailableWorkspaces()` extended to accept optional `scanResults`
  parameter, merging file-based registry, in-memory registrations, and scan
  results with deduplication by resolved absolute path
- Auto-registration on startup (`server/index.js`) scanning configured roots
  after `loadSettings()` and registering discoveries before WebSocket server
  setup
- Settings change re-scan (`server/index.js`) comparing previous and new
  discovery settings in the `watchSettings()` callback, triggering re-scan when
  `scan_roots` or `scan_depth` change
- Workspace picker enhancement (`app/views/workspace-picker.js`) showing
  "ProjectName - /path" in dropdown options for multi-workspace scenarios
- 11 unit tests in `server/discovery.test.js` covering depth limits, exclusion
  patterns, nonexistent roots, empty roots, metadata.json detection, and
  multi-root scanning
- Parent field investigation: confirmed `bd list --json` includes `parent` field
  on all issue types (task, epic, feature), containing parent ID for children
  and null for root-level issues

### Deviations from Plan

- Workspace picker enhancement was in `app/views/workspace-picker.js` (not
  `app/views/nav.js` as originally suggested in the PRD). The workspace picker
  component was already extracted as a separate view module.

### Key Patterns Established

- **Directory scanning**: Recursive `walkDir()` with depth counter and
  `shouldSkip()` filter, following the same `fs.readdirSync` with
  `{ withFileTypes: true }` pattern used by `findNearestBeadsDb()` in
  `server/db.js`
- **Registry merge**: Three-source merge (file registry, in-memory, scan
  results) with progressive deduplication using a `Set` of resolved paths
- **Settings change detection**: Previous settings comparison using
  `JSON.stringify` for arrays and direct comparison for scalars, triggering
  re-scan only on actual changes

## Phase 3 Outcomes

### What Was Completed

- `BoardFilters` typedef and `board_filters` field added to `AppState` in
  `app/state.js` with deep merge in `setState()` and change detection in the
  shallow-compare guard
- `IssueLite` typedef extended with `parent` and `assignee` fields in
  `app/views/board.js`
- `getFilterOptions()` function scanning all `column_data` and `column_raw` Map
  entries for unique parent, assignee, and issue_type values, sorted
  alphabetically
- `filterBarTemplate()` rendering three `<select>` dropdowns (Parent/Epic,
  Assignee, Type) with "All" default options above the board grid
- `applyBoardFilters()` applying AND logic across all `column_data` Map entries,
  called after `applyClosedFilter()` and after `getFilterOptions()` (so
  dropdowns show all values, not the filtered subset)
- `onBoardFilterChange()` handler updating store and triggering
  `refreshFromStores()` on filter dropdown change events
- Filter bar CSS styling in `app/styles.css` with flex layout, responsive wrap
  at 1100px breakpoint, matching existing closed filter select appearance
- localStorage persistence using separate `beads-ui.board-filters` key to avoid
  breaking existing `beads-ui.board` closed_filter persistence
- 7 unit tests in `app/views/board.test.js` covering filter bar rendering,
  dropdown population, single filter, AND logic, clearing filters, dropdown
  options computed before filtering, and filtering across 5 dynamic columns

### Deviations from Plan

- Re-implemented against Phase 1's dynamic column model (`col_defs`,
  `column_data` Map, `column_raw` Map) rather than the original static 4-column
  model. The original Phase 3 implementation referenced `list_blocked`,
  `list_ready`, `list_in_progress`, `list_closed` variables that no longer
  existed after Phase 1's refactor.
- Used separate `beads-ui.board-filters` localStorage key instead of nesting
  inside `beads-ui.board` to maintain backwards compatibility with existing
  closed_filter persistence.
- Filter options scan `column_raw` in addition to `column_data` to include
  values from closed items that may be excluded by the closed date filter.

### Key Patterns Established

- **Filter state deep merge**: `board_filters` uses nested deep merge in
  `setState()` so individual filter fields can be updated without clobbering
  others (e.g., `{ board_filters: { type: 'task' } }` preserves parent and
  assignee values)
- **Options-before-filter ordering**: `getFilterOptions()` is called before
  `applyBoardFilters()` in `refreshFromStores()` so dropdown options always show
  all available values regardless of active filters
- **Defensive filter state access**: `board_state?.board_filters || defaults`
  pattern handles legacy stores that lack `board_filters` field (e.g., test
  mocks from pre-filter era)
- **Separate localStorage keys**: New feature state uses its own key
  (`beads-ui.board-filters`) rather than extending existing keys, preventing
  schema migration issues

## Remediation Requirements (Added at Review - Round 1)

Review conducted on 2026-03-23. Phase 3 (Kanban Filters) was implemented against
the static 4-column board model because Phase 1's staging branch
(staging/beads-ui-w49.2) was never merged to the feature branch. Phase 3's code
references `list_blocked`, `list_ready`, `list_in_progress`, `list_closed`
variables that Phase 1 replaced with a dynamic `column_data` Map. Phase 3 was
reverted and Phase 1 merged. Phase 3 must be re-implemented on the dynamic
column model.

### Phase R1: Kanban Filters on Dynamic Columns

**Priority**: P1 **Scope**: Re-implement Phase 3 filter bar, dropdown
population, client-side filtering, and persistence using Phase 1's dynamic
column model (`col_defs`, `column_data` Map, `column_raw` Map).

#### Deliverables

- [x] R1-1: Filter state schema (`app/state.js`) - BoardFilters typedef with
      parent, assignee, type fields (P2)
- [x] R1-2: Filter dropdown population (`app/views/board.js`) - scan
      `column_data` Map values for unique parent, assignee, issue_type values
      (P2)
- [x] R1-3: Filter bar component (`app/views/board.js`) - three select dropdowns
      above dynamic board grid, wrapped in panel\_\_body div (P2)
- [x] R1-4: Client-side filtering (`app/views/board.js`) - applyBoardFilters()
      in refreshFromStores() using AND logic on dynamic column data (P2)
- [x] R1-5: Filter bar CSS styling (`app/styles.css`) - flex layout matching
      existing filter conventions (P2)
- [x] R1-6: Filter state localStorage persistence (`app/main.js`) -
      board_filters in beads-ui.board key (P2)
- [x] R1-7: Filter unit tests (`app/views/board.test.js`) - rendering,
      population, filtering, AND logic, clear, persistence on dynamic columns
      (P2)
- [x] R1-8: Update PRD with Phase 3 re-implementation outcomes
      (`docs/requirements/beads-ui-enhancements-prd.md`) (P2)

#### Decisions

| Finding                                   | Category             | Resolution Path                                           |
| ----------------------------------------- | -------------------- | --------------------------------------------------------- |
| Phase 3 incompatible with dynamic columns | MIGRATION_INCOMPLETE | Full re-implementation using col_defs and column_data Map |

#### Verification

- [x] `npm test` passes (all tests including new filter tests)
- [x] `npm run tsc` passes
- [x] `npm run lint` passes
- [x] Filter bar renders above dynamic board with three dropdowns
- [x] Filters work across all dynamic columns (not just hardcoded 4)

## Remediation Requirements (Added at Review - Round 2)

Review conducted on 2026-03-22. Comprehensive code review across all 4 phases
identified 40 findings (1 critical, 4 major, 3 high, 8 medium, 7 minor, 8 low, 9
informational). All classified as Fix Required, grouped into 4 remediation
phases below.

### Phase R2: App Bootstrap Resilience

**Priority**: P1 **Scope**: Fix race condition in settings bootstrap, add column
schema validation, fix async unsubscribe ordering, and improve push handler
robustness in app/main.js and app/protocol.js.

#### Deliverables

- [ ] C1: Fix race condition where get-settings fetch completes after initial
      ensureTabSubscriptions (`app/main.js:529-547`). Await settings response
      before first board subscription, or re-trigger subscriptions when initial
      settings arrive. (critical)
- [ ] H1: Add schema validation on settings-changed and get-settings column
      definitions (`app/main.js:506,538`). Validate each column has id, label,
      subscription, drop_status as strings before assigning to board_columns.
      (high)
- [ ] H2: Await unsubscribe promises in clearAndResubscribe before creating new
      subscriptions (`app/main.js:189-230`). Prevents subscription ID conflicts
      and stale push data. (high)
- [ ] Me1: Extract shared helper for duplicated snapshot/upsert/delete event
      handler pattern (`app/main.js:113-148`). (medium)
- [ ] Me2: Add debug logging to silent catch blocks in push handlers
      (`app/main.js:120,132,144`). (medium)
- [ ] Me3: Rename shadowed `data` variable in store.subscribe callback
      (`app/main.js:614`). (medium)
- [ ] Me4: Consolidate two separate store.subscribe persistence callbacks into
      one (`app/main.js:612-634`). (medium)
- [ ] Me5: Strengthen isRequest type guard to validate message type against
      MESSAGE_TYPES (`app/protocol.js:153-162`). (medium)

#### Decisions

| Finding | Category             | Resolution Path                                                      |
| ------- | -------------------- | -------------------------------------------------------------------- |
| C1      | MIGRATION_INCOMPLETE | Await get-settings before onRouteChange, or re-subscribe on response |
| H1      | COVERAGE_GAP         | Per-column field validation with fallback to defaults                |
| H2      | MIGRATION_INCOMPLETE | Sequential async teardown before rebuild                             |

#### Verification

- [ ] `npm test` passes
- [ ] `npm run tsc` passes
- [ ] `npm run lint` passes
- [ ] Board renders server-configured columns on first load (not defaults)
- [ ] Settings hot-reload completes without subscription conflicts

### Phase R3: Board View Lifecycle

**Priority**: P1 **Scope**: Fix memory leaks in board view teardown, correct
subscription mode mapping for dynamic columns, harden filter null safety, and
clean up minor code quality issues in app/views/board.js and app/state.js.

#### Deliverables

- [ ] M1: Store selectors.subscribe() unsubscribe function and call it in
      clear() (`app/views/board.js:872-880`). Prevents ghost renders from
      orphaned closures on settings-change rebuild. (major)
- [ ] M2: Remove 4 event listeners (keydown, dragover, dragleave, drop) on
      mount_element in clear() (`app/views/board.js:499,602,625,636`). Prevents
      duplicate handlers accumulating on rebuild. (major)
- [ ] M3: Fix subscriptionToMode to handle unknown subscription types correctly
      (`app/views/board.js:761-773`). Derive mode from column drop_status or
      ColumnDef rather than defaulting to 'ready'. (major)
- [ ] M4: Normalize undefined to null in applyBoardFilters filter comparison
      (`app/views/board.js:796`). Prevent accidental filtering when
      board_filters state is partially constructed. (major)
- [ ] Mi1: Use column ID in closed filter select element ID instead of hardcoded
      "closed-filter" (`app/views/board.js:306`). (minor)
- [ ] Mi2: Replace em-dash with hyphen in aria-label string
      (`app/views/board.js:484`). (minor)
- [ ] Mi3: Update fallback fetch to handle dynamic column types, not just legacy
      4-method API (`app/views/board.js:914`). (minor)
- [ ] Mi4: Replace identity .map((it) => it) with .slice()
      (`app/views/board.js:936`). (minor)
- [ ] Mi5: Move filter_options from module-level mutable to local variable or
      return value (`app/views/board.js:129-130`). (minor)
- [ ] Mi6: Update setState JSDoc signature to include board and view fields
      (`app/state.js:55`). (minor)
- [ ] Mi7: Review shallow workspace comparison for deep change detection
      (`app/state.js:135-137`). (minor)
- [ ] I1: Consider refactoring createBoardView from 8 positional params to
      options object (`app/views/board.js`). (informational)
- [ ] I2: Add debug logging in catch block that zeros columns on error
      (`app/views/board.js`). (informational)
- [ ] I3: Consider boolean is_closed flag on ColumnDef to replace string
      matching in 7 places (`app/views/board.js`). (informational)

#### Decisions

| Finding | Category             | Resolution Path                              |
| ------- | -------------------- | -------------------------------------------- |
| M1, M2  | ABSTRACTION_MISSING  | Add destroy/cleanup lifecycle to board view  |
| M3      | MIGRATION_INCOMPLETE | Mode mapping not updated for dynamic columns |
| M4      | COVERAGE_GAP         | Null/undefined normalization in filter logic |

#### Verification

- [ ] `npm test` passes
- [ ] `npm run tsc` passes
- [ ] `npm run lint` passes
- [ ] Settings hot-reload does not leak event listeners or subscriptions
- [ ] Custom column types get correct sorting semantics

### Phase R4: Discovery and Registry Hardening

**Priority**: P2 **Scope**: Fix TDZ risk in server startup ordering, add symlink
loop protection, add test coverage for registry-watcher.js, fix path dedup
inconsistency, and address watcher cleanup in server/index.js,
server/discovery.js, server/registry-watcher.js, and server/list-adapters.js.

#### Deliverables

- [x] H3: Reorder watchDb after attachWsServer to avoid scheduleListRefresh TDZ
      reference (`server/index.js:85-90`). (high)
- [x] Me6: Add symlink detection to prevent infinite loops on cyclic links
      (`server/discovery.js:76-79`). (medium)
- [x] Me7: Add unit tests for registry-watcher.js covering
      getAvailableWorkspaces merge, dedup, readRegistry error handling, and
      findWorkspaceEntry path matching (`server/registry-watcher.js`). (medium)
- [x] Me8: Use path.resolve() consistently for dedup in discoverAndRegister to
      match getAvailableWorkspaces behavior (`server/index.js:55-73`). (medium)
- [x] L6: Consider async scanning for settings-change re-scan path to avoid
      blocking the event loop (`server/discovery.js:90`). (low)
- [x] L7: Store watcher handles (watchRegistry, watchSettings) and clean up on
      server shutdown (`server/index.js:129-137`). (low)
- [x] L8: Register discovered workspaces with meaningful database path instead
      of empty string (`server/registry-watcher.js:22-31`). (low)
- [x] I4: Add --limit flag to status-issues queries for consistency with other
      subscription types (`server/list-adapters.js`). (informational)
- [x] I8: Add logging for readRegistry errors instead of silent empty array
      return (`server/registry-watcher.js`). (informational)
- [x] I9: Implement proactive workspace list push in watchRegistry callback
      instead of no-op (`server/index.js:129-137`). (informational)

#### Decisions

| Finding | Category             | Resolution Path                                        |
| ------- | -------------------- | ------------------------------------------------------ |
| H3      | MIGRATION_INCOMPLETE | Reorder startup sequence                               |
| Me6     | COVERAGE_GAP         | entry.isSymbolicLink() check or visited inode tracking |
| Me7     | COVERAGE_GAP         | New test file server/registry-watcher.test.js          |

#### Verification

- [x] `npm test` passes (including new registry-watcher tests)
- [x] `npm run tsc` passes
- [x] `npm run lint` passes
- [x] Server startup ordering verified with watchDb after attachWsServer

### Phase R5: Settings Validation

**Priority**: P2 **Scope**: Add input validation for user-supplied settings, fix
mutable reference sharing, and harden settings module in server/settings.js and
server/config.js.

#### Deliverables

- [x] L1: Initialize cached settings as a clone of DEFAULT_SETTINGS, not a
      shared reference (`server/settings.js:62`). (low)
- [x] L2: Return a frozen or cloned copy from getSettings() to prevent
      accidental mutation (`server/settings.js:90-92`). (low)
- [x] L3: Validate user-supplied column definitions in mergeDefaults - check
      each element has id, label, subscription, drop_status as strings. Reject
      or filter invalid entries (`server/settings.js:171-187`). (low)
- [x] L4: Validate discovery section values - scan_roots is array of strings,
      scan_depth is positive integer (`server/settings.js:171-187`). (low)
- [x] L5: Validate server section values - port is number, host is string
      (`server/settings.js:171-187`). (low)
- [x] I5: Document that JSON.stringify change detection is key-order dependent
      (acceptable behavior) (`server/settings.js`). (informational)
- [x] I6: Document that persistent:true on watcher is intentional for
      long-running server (`server/settings.js`). (informational)
- [x] I7: Document that CLI flag precedence is achieved via process.env mutation
      in index.js (`server/config.js`). (informational)

#### Decisions

| Finding    | Category            | Resolution Path                              |
| ---------- | ------------------- | -------------------------------------------- |
| L1, L2     | ABSTRACTION_MISSING | Immutable settings access pattern            |
| L3, L4, L5 | COVERAGE_GAP        | validateSettings() function in mergeDefaults |

#### Verification

- [x] `npm test` passes (including new validation tests)
- [x] `npm run tsc` passes
- [x] `npm run lint` passes
- [x] Malformed config.json logs warning and falls back to defaults

## Remaining Open Questions

(none)

## Resolved Questions

| Question                                       | Decision              | Notes                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should `in_review` be added to the bd CLI?     | No, already supported | bd CLI already accepts custom statuses including `in_review`. The UI just needs to query for it via `status-issues` subscription.                                                                              |
| Hot-reload vs page refresh on settings change? | Auto hot-reload       | Client tears down old subscriptions and rebuilds with new column definitions when `settings-changed` event arrives. Worth the complexity for polished UX.                                                      |
| Does `bd list --json` include `parent` field?  | Yes, always present   | Confirmed in Phase 2 investigation: `parent` field present on all issue types (task, epic, feature). Contains parent ID for children, null for root-level. Phase 3 Parent/Epic filter is feasible as designed. |
