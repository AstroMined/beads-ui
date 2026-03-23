# beads-ui Enhancements PRD

**Status:** Draft **Date:** 2026-03-22 (Phase 2 completed 2026-03-22)
**Author:** Ryan Peterson **Related:**
[mantoni/beads-ui](https://github.com/mantoni/beads-ui) (upstream)

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

- [ ] Generic `status-issues` subscription type in `server/list-adapters.js`
      that accepts a `status` parameter and maps to
      `bd list --json --tree=false --status <param>`
- [ ] Validator update in `server/validators.js` adding `status-issues` to
      `SUBSCRIPTION_TYPES` with param validation requiring non-empty
      `params.status` string
- [ ] Board view refactor in `app/views/board.js`: replace hardcoded
      `COLUMN_STATUS_MAP` and four `list_*` variables with dynamic column
      generation from settings, using a `Map<string, IssueLite[]>` keyed by
      column ID
- [ ] Dynamic `ensureTabSubscriptions()` in `app/main.js`: iterate over column
      definitions from settings to create subscriptions instead of hardcoded
      four, with full teardown and rebuild on `settings-changed` events
      (hot-reload)
- [ ] Dynamic CSS grid in `app/styles.css`: change `.board-root` from
      `repeat(4, 1fr)` to `repeat(var(--board-columns, 4), 1fr)` with
      `overflow-x: auto` for horizontal scrolling when many columns
- [ ] Drag-drop status mapping using `drop_status` field from column definition,
      preserving existing `update-status` WebSocket message handler without
      modification
- [ ] Preserve existing closed column date filter for columns with
      `subscription: 'closed-issues'`
- [ ] Unit tests for `status-issues` adapter, dynamic column rendering, and
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

- [ ] Filter bar component in `app/views/board.js` rendering above the board
      grid with three `<select>` dropdowns: Parent/Epic, Assignee, and Type
- [ ] Dropdown population logic that scans all issues across all column stores
      to extract unique parent, assignee, and issue_type values, sorted
      alphabetically
- [ ] Client-side filtering in `refreshFromStores()` applying `Array.filter()`
      to each column's issue list before rendering, with empty filter value
      meaning "show all"
- [ ] Board filter state (`board_filters: { parent, assignee, type }`) added to
      `app/state.js` AppState with localStorage persistence following existing
      `beads-ui.board` pattern
- [ ] Filter bar styling in `app/styles.css` with flex layout above the board
      grid, matching existing filter UI conventions from the Issues list view
- [ ] Unit tests for filter bar rendering, filtering logic (single filter,
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

- [ ] `npm test` passes with all updated board and adapter tests
- [ ] Board renders default 4 columns when no custom config exists
- [ ] Board renders 5+ columns when config includes custom columns (e.g.,
      `in_review`)
- [ ] Dragging a card to a custom column updates its status to the column's
      `drop_status` value
- [ ] Board is horizontally scrollable when column count exceeds viewport width
- [ ] Closed column date filter still works on closed-type columns
- [ ] Keyboard navigation (arrow keys, Enter/Space) works across dynamic columns

### Phase 2

- [x] `npm test` passes with all discovery module tests
- [x] Starting server in `/code/` discovers projects in subdirectories (e.g.,
      beads-ui, skyauto-triage)
- [x] Discovered projects appear in workspace picker
- [x] Switching to a discovered workspace loads its issues correctly
- [x] Projects already in registry.json are not duplicated
- [x] Scan respects depth limit (does not recurse beyond configured depth)

### Phase 3

- [ ] `npm test` passes with all filter tests
- [ ] Filter bar renders above board with three dropdowns
- [ ] Selecting a parent/epic filter shows only cards belonging to that parent
- [ ] Selecting an assignee filter shows only cards assigned to that person
- [ ] Selecting a type filter shows only cards of that type
- [ ] Combining multiple filters applies AND logic (intersection)
- [ ] Clearing all filters restores full board view
- [ ] Filter selections persist across page reloads (localStorage)

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

## Phase 2 Outcomes

### What Was Completed

- Discovery module (`server/discovery.js`) with `scanForWorkspaces(roots, depth)` using
  recursive `fs.readdirSync` with `{ withFileTypes: true }`, skipping `node_modules`, `.git`,
  and hidden directories, detecting `.beads/` subdirectories containing `*.db` or `metadata.json`
- Registry integration (`server/registry-watcher.js`) with `getAvailableWorkspaces()` extended
  to accept optional `scanResults` parameter, merging file-based registry, in-memory
  registrations, and scan results with deduplication by resolved absolute path
- Auto-registration on startup (`server/index.js`) scanning configured roots after
  `loadSettings()` and registering discoveries before WebSocket server setup
- Settings change re-scan (`server/index.js`) comparing previous and new discovery settings
  in the `watchSettings()` callback, triggering re-scan when `scan_roots` or `scan_depth` change
- Workspace picker enhancement (`app/views/workspace-picker.js`) showing "ProjectName - /path"
  in dropdown options for multi-workspace scenarios
- 11 unit tests in `server/discovery.test.js` covering depth limits, exclusion patterns,
  nonexistent roots, empty roots, metadata.json detection, and multi-root scanning
- Parent field investigation: confirmed `bd list --json` includes `parent` field on all issue
  types (task, epic, feature), containing parent ID for children and null for root-level issues

### Deviations from Plan

- Workspace picker enhancement was in `app/views/workspace-picker.js` (not `app/views/nav.js`
  as originally suggested in the PRD). The workspace picker component was already extracted as a
  separate view module.

### Key Patterns Established

- **Directory scanning**: Recursive `walkDir()` with depth counter and `shouldSkip()` filter,
  following the same `fs.readdirSync` with `{ withFileTypes: true }` pattern used by
  `findNearestBeadsDb()` in `server/db.js`
- **Registry merge**: Three-source merge (file registry, in-memory, scan results) with
  progressive deduplication using a `Set` of resolved paths
- **Settings change detection**: Previous settings comparison using `JSON.stringify` for
  arrays and direct comparison for scalars, triggering re-scan only on actual changes

## Remaining Open Questions

(none)

## Resolved Questions

| Question                                       | Decision              | Notes                                                                                                                                                     |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should `in_review` be added to the bd CLI?     | No, already supported | bd CLI already accepts custom statuses including `in_review`. The UI just needs to query for it via `status-issues` subscription.                         |
| Hot-reload vs page refresh on settings change? | Auto hot-reload       | Client tears down old subscriptions and rebuilds with new column definitions when `settings-changed` event arrives. Worth the complexity for polished UX. |
| Does `bd list --json` include `parent` field?  | Yes, always present   | Confirmed in Phase 2 investigation: `parent` field present on all issue types (task, epic, feature). Contains parent ID for children, null for root-level. Phase 3 Parent/Epic filter is feasible as designed. |
