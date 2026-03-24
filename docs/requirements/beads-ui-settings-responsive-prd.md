# beads-ui Settings & Responsive Board PRD

**Status:** Draft
**Date:** 2026-03-24
**Author:** Ryan Peterson
**Related:** [beads-ui Enhancements PRD](archive/beads-ui-enhancements-prd.md) (predecessor, archived)

## Context

The beads-ui kanban board and settings engine built in w49 serve their purpose but impose several workflow friction points as usage scales. Settings are global-only (`~/.beads/config.json`), which forces every project to share the same board column layout. A data science project with "Exploration / Modeling / Validation" stages and a web app with "Blocked / Ready / In Progress / In Review / QA / Closed" columns cannot coexist without manual JSON file swaps.

Today, column layout is defined in a single global JSON file. There is no UI for managing settings, so every change requires opening `~/.beads/config.json` in a text editor, knowing the exact schema, and restarting or waiting for file-watch to pick up changes. The board's CSS grid uses a fixed `min-width: 380px` per column, which means five columns on a standard 1920px (1080p) monitor produce a horizontal scrollbar (5 columns at 380px + gaps + padding = ~2076px). There is no way to temporarily hide columns to focus on a subset of the workflow.

The immediate motivation is reducing daily friction: eliminating horizontal scroll for the default five-column layout, enabling per-project board customization without file juggling, and providing a proper settings UI so JSON editing is no longer required. These improvements build incrementally on the w49 settings engine and board infrastructure.

## Current State Analysis

### Codebase Landscape

- **Runtime**: Node.js >= 22, ESM modules throughout
- **Server**: Express 4.x HTTP + ws WebSocket library, push-based subscription model
- **Client**: lit-html templates, simple store-based state management (`createStore`)
- **Build**: esbuild (ESM, es2020 target) | **Test**: vitest (dual node/jsdom) | **Lint**: eslint + prettier
- **Key deps**: express, ws, lit-html, marked, dompurify, debug
- **Commands**: `npm test`, `npm run tsc`, `npm run lint`, `npm run prettier:check`

### Relevant Modules

| Module | Path | Current Responsibility |
|--------|------|----------------------|
| Settings engine | `server/settings.js` | Load, validate, merge, watch `~/.beads/config.json`. Exports `loadSettings()`, `getSettings()`, `watchSettings()` |
| Config resolver | `server/config.js` | Resolves port/host from CLI flags > env vars > settings > defaults via `getConfig()` |
| Board view | `app/views/board.js` (~1041 lines) | Dynamic column kanban with drag-drop, keyboard nav, filters, closed-date filter |
| WebSocket server | `server/ws.js` (~1383 lines) | 25 message types including `get-settings`, `settings-changed` broadcast |
| Server bootstrap | `server/index.js` | Settings watcher, workspace registration, discovery triggering |
| App state | `app/state.js` | Store with `{ selected_id, view, filters, board, workspace }` |
| Bootstrap | `app/main.js` | SPA shell, column validation, settings hot-reload, board subscription lifecycle |
| Protocol | `app/protocol.js` | Message type definitions and `MESSAGE_TYPES` array |
| List adapters | `server/list-adapters.js` | 8 subscription types mapping to `bd` CLI commands |
| Styles | `app/styles.css` | Board grid (lines 1231-1364), filter dropdowns (lines 923-988), CSS variable design system |
| New issue dialog | `app/views/new-issue-dialog.js` | Reference pattern for forms: grid layout, native elements, aria-live errors |
| Router | `app/router.js` | Hash-based routing: `#/issues`, `#/epics`, `#/board` |

### Existing Patterns

- **View factory pattern**: All views use `createXxxView(options)` returning `{ load, clear }`. The board view factory accepts `BoardViewOptions` including a `columns` array. New views must follow this convention.
- **Subscription model**: Each board column maps to a WebSocket subscription backed by a `bd` CLI command. Subscription types are validated against `SUBSCRIPTION_TYPES` in `server/validators.js`. New columns must use existing subscription types.
- **Settings lifecycle**: Settings load at startup via `loadSettings()`, are watched with 500ms debounce, and changes broadcast via `settings-changed` WebSocket event. Client re-validates columns and rebuilds the board on change. All returned settings use `structuredClone()` for immutability.
- **Filter dropdown CSS**: `.filter-dropdown` component with `.is-open` toggle, `.filter-dropdown__trigger` button, `.filter-dropdown__menu` positioned absolutely, `.filter-dropdown__option` items with checkbox support. Already fully styled.
- **Dialog/form pattern**: `new-issue-dialog.js` demonstrates grid-based form layout, native `<form>`/`<input>`/`<select>`, submit with busy state, `aria-live` error region. New forms should follow this pattern.
- **Column validation**: Both server (`mergeDefaults()`) and client (`validateColumnDefs()`) validate columns identically: `id`, `label`, `subscription`, `drop_status` must be non-empty strings. Invalid columns are filtered out; if none valid, defaults apply.

### Integration Points

| Integration Point | Direction | Impact |
|-------------------|-----------|--------|
| `get-settings` WS message | Client <- Server | Must return effective (merged) settings, not just global |
| `settings-changed` broadcast | Server -> All clients | Must broadcast effective settings on either global or project file change |
| `ensureTabSubscriptions()` in `main.js` | Client internal | Subscribes based on `board_columns` array; must handle visible vs hidden columns correctly |
| Workspace switching (`set-workspace`) | Client -> Server | Must trigger project settings reload and broadcast |
| File watcher (`watchSettings`) | Server internal | Must watch both global and project config files |
| Board `--board-columns` CSS variable | Template -> CSS | Must reflect visible column count for responsive grid |

### External Research Insights

- **CSS Grid `minmax()` with custom properties**: `repeat(N, minmax(var(--min), 1fr))` is well-supported in modern browsers. However, CSS `clamp()` cannot reference the column count dynamically (it comes from a JS-set variable), so the minimum width must be calculated in JS and applied as a CSS variable.
- **ResizeObserver**: The recommended modern approach for responding to element size changes, replacing `window.resize` listeners. Supported in all target browsers (Node 22 implies modern browser targets).
- **HTML5 Drag and Drop for list reorder**: The board already implements drag-drop for cards between columns using the native DnD API. The same pattern (dragstart/dragover/drop with insertion point calculation) works for list reorder in the settings column editor.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Per-project settings scope | Board columns only | Server config (port/host) and discovery (scan_roots/scan_depth) are inherently global - they configure the running server instance, not the viewed project |
| Settings merge strategy | Complete replacement | When project provides `board.columns`, it fully replaces global columns (not merge/extend). Matches existing atomic array validation pattern in `mergeDefaults()` |
| Responsive column approach | JS-calculated CSS variable | CSS `clamp()` cannot reference the dynamic column count from `--board-columns`. JS computes `--board-col-min-width` and CSS uses `minmax()` for layout |
| Card condensation | Progressive thresholds | < 260px: hide type badge, reduce padding. < 180px: title only. Priority badge persists until minimal mode (it is small and critical) |
| Settings UI location | Dedicated `#/settings` route | Full-page view provides room for tabbed editor with Global/Local tabs, column CRUD, and discovery settings |
| Settings UI navigation | Gear icon in header-actions | Settings is a system-level concern, not a content view. Keeps primary tab nav (Issues/Epics/Board) focused on content |
| Column visibility persistence | localStorage per workspace | `beads-ui.board-col-vis:<workspace_path>` key. Low-friction toggle without modifying settings files |
| Column management capability | Full CRUD + drag reorder | Complete replacement for JSON editing. Includes validation, subscription type picker, conditional params |
| Column visibility filter | Toggle only (no reorder) | Reordering is a settings concern; the board filter stays simple and fast |
| Settings save mechanism | Server writes JSON file | The `save-settings` WS message sends partial settings to server, which writes the file. Existing file watcher detects change and broadcasts |
| Project config file location | `<workspace>/.beads/config.json` | Same filename as global config but in the project's `.beads/` directory. Consistent naming, clear layering |

## Technology Stack

- **Language**: JavaScript (ESM) with TypeScript type checking via JSDoc annotations
- **Runtime**: Node.js >= 22
- **Server**: Express 4.x + ws (WebSocket)
- **Client**: lit-html for templates, native HTML elements for forms
- **Build**: esbuild
- **Test**: vitest (node + jsdom environments)
- **Lint**: eslint + prettier
- **CSS**: Custom properties design system, BEM naming convention
- **New dependencies**: None required. All features use existing capabilities.

## Non-Goals

- **Per-project server settings**: Port and host configuration remain global-only. Per-project server config would require running multiple server instances, which is a different architecture.
- **Per-project discovery settings**: Discovery scan_roots and scan_depth remain global. Discovery runs once at server startup to find all workspaces; per-project overrides would be circular (you need to discover a project before reading its settings).
- **Column merging/extending**: Per-project overrides fully replace global columns rather than merging or extending. Merge semantics (what does "extend" mean for reordered columns?) add complexity for unclear benefit.
- **Settings sync/export**: No mechanism to export settings or sync across machines. The config files are plain JSON and can be managed with dotfiles if needed.
- **Real-time collaborative editing**: The settings UI does not handle concurrent editors. If two browser tabs edit settings simultaneously, last-write wins. This is acceptable for a single-user tool.
- **Theme/appearance settings**: No UI for theme or visual customization beyond column layout. The existing `prefers-color-scheme` automatic dark mode is sufficient.
- **Column reordering in the board filter**: The board's column visibility dropdown only toggles show/hide. Reordering columns requires the Settings UI, keeping the board filter simple.

## Phased Roadmap

### Phase 0: Per-Project Settings Infrastructure
**Depends on:** none

- [ ] `loadProjectSettings(workspace_root)` function in `server/settings.js` that reads `<workspace>/.beads/config.json` and validates `board.columns` if present
- [ ] `getEffectiveSettings(workspace_root)` function that merges global settings with project overrides (project `board.columns` replaces global when valid)
- [ ] `watchProjectSettings(workspace_root, onChange)` function with same debounce pattern as `watchSettings()`, returning `{ close }` handle
- [ ] Update `get-settings` handler in `server/ws.js` to return effective (merged) settings for the active workspace
- [ ] New `get-project-settings` message type that returns raw project overrides (not merged), enabling the Settings UI to distinguish "inheriting" from "overriding"
- [ ] New `save-settings` message type accepting `{ scope: 'global' | 'project', settings: Partial<SettingsObject> }`, with server-side validation and atomic file write
- [ ] Wire project settings watcher in `server/index.js` with lifecycle management: close old watcher and open new one on workspace switch
- [ ] Broadcast effective settings on either global or project config file change
- [ ] Update `app/protocol.js` with new message types (`save-settings`, `get-project-settings`)
- [ ] Tests for project settings loading, merging, watching, saving, and workspace switch lifecycle

### Phase 1: Responsive Kanban Columns
**Depends on:** none (parallel with Phase 0)

- [x] `computeColMinWidth(viewportWidth, columnCount, gapPx, paddingPx)` utility in `app/views/board.js` that returns adaptive minimum column width floored at 180px
- [x] Set `--board-col-min-width` CSS variable on `.board-root` element alongside existing `--board-columns`
- [x] Replace CSS grid rule `repeat(var(--board-columns, 4), 1fr)` with `repeat(var(--board-columns, 4), minmax(var(--board-col-min-width, 300px), 1fr))` in `app/styles.css`
- [x] Remove fixed `min-width: 380px` from `.board-column` CSS rule
- [x] Add `.board-card--condensed` CSS class: hides type badge, reduces card padding, smaller meta font size (applied when column width < 260px)
- [x] Add `.board-card--minimal` CSS class: title-only display, hides all meta (applied when column width < 180px)
- [x] Register `ResizeObserver` on board mount element with 100ms debounced recalculation of column min-width and card condensation classes
- [x] Post-render column width inspection via `getBoundingClientRect()` to toggle condensed/minimal classes on cards
- [x] Tests for `computeColMinWidth` calculation logic

#### Phase 1 Outcomes

**What Was Completed:**
- `computeColMinWidth()` pure function added to `app/views/board.js` with 7 unit tests covering standard, edge, and floor cases
- CSS grid updated from fixed `1fr` to `minmax(var(--board-col-min-width, 300px), 1fr)` in `app/styles.css`
- Removed `min-width: 380px` from `.board-column`, eliminating forced horizontal scroll on 5-column layouts
- Added `.board-card--condensed` and `.board-card--minimal` CSS classes with progressive degradation thresholds
- `ResizeObserver` integration with 100ms debounce, registered on `load()` and disconnected on `clear()`
- Post-render `updateCardCondensation()` called after every `doRender()` to toggle card classes based on actual column widths
- 5 integration tests verifying ResizeObserver lifecycle and card condensation class toggling via mock ResizeObserver

**Deviations from Plan:**
- No deviations. All deliverables implemented as specified.

**Key Patterns Established:**
- `computeColMinWidth` is a standalone exported function (not inside `createBoardView` closure) for testability and reuse by Phase 2's `--board-columns` recalculation
- Card condensation uses `Array.from(querySelectorAll())` pattern for TypeScript compatibility with `NodeListOf` iteration
- ResizeObserver mock in tests uses a class-based mock (not `vi.fn()`) because `new ResizeObserver()` requires a constructor

### Phase 2: Column Visibility Filter
**Depends on:** Phase 0 (effective settings flow for column definitions)

- [ ] Add `column_visibility` state (`Record<string, boolean>`) to board view local state, defaulting all columns to visible
- [ ] Column visibility dropdown in the board filter bar following existing `.filter-dropdown` pattern: trigger button labeled "Columns" with "N/M" count badge, checkbox menu per column
- [ ] Filter `col_defs` by visibility before mapping to `columnTemplate()` in the board template function
- [ ] Update `--board-columns` CSS variable to reflect visible column count (integrates with Phase 1 responsive grid)
- [ ] Persist visibility state to localStorage keyed by workspace path (`beads-ui.board-col-vis:<workspace_path>`)
- [ ] Load visibility state from localStorage on board view `load()`, with reconciliation: new columns default visible, removed columns pruned
- [ ] Keep subscriptions active for hidden columns (visibility is a render-only concern, not a data concern)
- [ ] Tests for visibility toggle, persistence, reconciliation with column changes

### Phase 3: Settings UI
**Depends on:** Phase 0 (save-settings protocol and per-project infrastructure)

- [ ] Add `'settings'` to `ViewName` type in `app/state.js` and extend `parseView()` in `app/router.js` to handle `#/settings`
- [ ] Add settings gear icon button in header-actions area of `app/index.html` (alongside theme toggle)
- [ ] Add `<section id="settings-root" class="route settings" hidden>` to the SPA shell in `app/main.js` with route visibility management
- [ ] Create `app/views/settings.js` with `createSettingsView(mount_element, store, transport)` factory returning `{ load, clear }`
- [ ] Tabbed layout with "Global" and "Local (project-name)" tabs using `role="tablist"` / `role="tab"` / `aria-selected` pattern
- [ ] Global tab: column editor with sortable list (drag handles, edit/delete buttons per row, "Add Column" button)
- [ ] Global tab: discovery settings editor (scan_roots list with add/remove, scan_depth number input)
- [ ] Column add/edit form: id (text, kebab-case validated), label (text), subscription (select of 8 types from `SUBSCRIPTION_TYPES`), params (conditional on subscription type), drop_status (select: open/in_progress/in_review/closed)
- [ ] Conditional params UI: show status text input for `status-issues`, issue ID input for `issue-detail`, hidden for all other subscription types
- [ ] Auto-suggest drop_status based on selected subscription type (e.g., `closed-issues` suggests "closed")
- [ ] Drag-to-reorder columns using HTML5 DnD API (same pattern as board card drag in `board.js`)
- [ ] Keyboard reorder: ArrowUp/Down on drag handle swaps position, with `aria-live` announcement of new position
- [ ] Local tab: radio toggle "Inherit global columns" (default) / "Override with custom columns", with column editor shown only in override mode
- [ ] Validation: ID uniqueness, required fields, subscription-specific param requirements, with `aria-live` error display
- [ ] Dirty detection via `JSON.stringify` comparison of draft vs saved state
- [ ] Save button dispatches `save-settings` via transport (scope based on active tab), Reset button reverts to server state
- [ ] External change handling: silent update when form is clean, toast notification when form is dirty
- [ ] Settings page CSS: form grid layout, column editor rows, drag handle styling, tab bar, all using CSS variables and BEM naming
- [ ] Tests for settings view lifecycle, column CRUD operations, validation, and dirty state management

## UX / Architecture Details

### Settings UI Layout

```
+--------------------------------------------------+
| [Issues] [Epics] [Board]            [gear] [sun] |
+--------------------------------------------------+
| Settings                                          |
|                                                   |
| [Global] [Local: my-project]                      |
| ------------------------------------------------  |
|                                                   |
| Board Columns                                     |
| +----------------------------------------------+  |
| | drag  | Blocked     | blocked-issues  | open | [edit] [x] |
| | drag  | Ready       | ready-issues    | open | [edit] [x] |
| | drag  | In Progress | in-progress-... | in_p | [edit] [x] |
| | drag  | In Review   | status-issues   | in_p | [edit] [x] |
| | drag  | Closed      | closed-issues   | clos | [edit] [x] |
| |                                                |  |
| |              [+ Add Column]                    |  |
| +----------------------------------------------+  |
|                                                   |
| Discovery (global only)                           |
| +----------------------------------------------+  |
| | Scan roots:                                    |  |
| |   /code                              [x]      |  |
| |   [+ Add root]                                 |  |
| | Scan depth: [2]                                |  |
| +----------------------------------------------+  |
|                                                   |
|                          [Save]  [Reset]          |
+--------------------------------------------------+
```

### Column Add/Edit Form

```
+----------------------------------------------+
| Column Definition                             |
|                                               |
| ID:           [my-column_____________]        |
| Label:        [My Column_____________]        |
| Subscription: [status-issues_________] v      |
| Status param: [in_review_____________]   <-- conditional
| Drop status:  [in_progress___________] v      |
|                                               |
|                    [Add Column]  [Cancel]      |
+----------------------------------------------+
```

### Board Column Visibility Filter

```
+---------------------------------------------------+
| Filters: [Parent v] [Assignee v] [Type v] [Columns 4/5 v] |
+---------------------------------------------------+
                                      |  [x] Blocked    |
                                      |  [x] Ready      |
                                      |  [x] In Progress |
                                      |  [ ] In Review   |
                                      |  [x] Closed      |
                                      +------------------+
```

### Responsive Column Behavior

```
5 columns on 1920px (comfortable):
+--------+--------+--------+--------+--------+
|Blocked |Ready   |In Prog |In Rev  |Closed  |
|~340px  |~340px  |~340px  |~340px  |~340px  |
|        |        |        |        |        |
|[card]  |[card]  |[card]  |[card]  |[card]  |
|full    |full    |full    |full    |full    |
|meta    |meta    |meta    |meta    |meta    |
+--------+--------+--------+--------+--------+
No scroll

8 columns on 1920px (condensed):
+------+------+------+------+------+------+------+------+
|Block |Ready |Prog  |Rev   |QA    |Stage |Close |Arch  |
|~210px each                                             |
|[card]|[card]|[card]|[card]|[card]|[card]|[card]|[card]|
|title |title |title |title |title |title |title |title |
|prio  |prio  |prio  |prio  |prio  |prio  |prio  |prio  |
+------+------+------+------+------+------+------+------+
No scroll (type badge hidden, padding reduced)

10+ columns on 1920px (minimal + scroll):
+-----+-----+-----+-----+-----+-----+-----+-----+-----+----->
|180px each, title only, horizontal scroll enabled      |
+-----+-----+-----+-----+-----+-----+-----+-----+-----+----->
```

### Data Flow: Settings Merge

```
                    ~/.beads/config.json (global)
                              |
                    loadSettings() -> cached global
                              |
    <workspace>/.beads/config.json (project, optional)
                              |
                    loadProjectSettings(root) -> project columns or null
                              |
                    getEffectiveSettings(root)
                    = global + project board.columns override
                              |
              +---------------+---------------+
              |                               |
    get-settings response            settings-changed broadcast
    (client request)                 (file change detected)
              |                               |
    Client: validateColumnDefs() -> board_columns
              |
    createBoardView({ columns: board_columns })
```

### Data Flow: Settings Save

```
    Settings UI: user edits columns, clicks Save
              |
    transport('save-settings', {
      scope: 'global' | 'project',
      settings: { board: { columns: [...] } }
    })
              |
    Server: validate columns with validateColumnDef()
              |
    Server: atomic write to appropriate config.json
    (write to temp file, then rename)
              |
    File watcher detects change (500ms debounce)
              |
    broadcastSettingsChanged(effectiveSettings)
              |
    All clients receive settings-changed event
              |
    Board rebuilds with new columns
```

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Project config file conflicts with `.beads/` database files | Medium - could confuse beads CLI or corrupt data | Use `config.json` filename (already used globally). Beads database uses `.db` files and `metadata.json`, no overlap |
| Atomic file write race condition | Low - two rapid saves could interleave | Use write-to-temp-then-rename pattern. File watcher debounce (500ms) coalesces rapid changes |
| ResizeObserver performance overhead | Low - could cause layout thrash on rapid resize | Debounce recalculation to 100ms. Only toggle classes when threshold is actually crossed |
| Card condensed mode readability | Medium - narrow columns may be unusable below certain widths | Hard floor at 180px before scroll kicks in. Progressive degradation (full -> condensed -> minimal) gives clear visual feedback |
| Settings UI dirty state vs external changes | Medium - external file edit while form is dirty could cause confusion | Toast notification for external changes when dirty, silent update when clean. User must explicitly save or cancel |
| Column visibility hides important data | Low - users may forget columns are hidden | "Columns N/M" badge in filter bar makes hidden columns visible. All columns shown by default |

## Verification Plan

### Phase 0
- [ ] `npm test` passes with all new settings tests
- [ ] `npm run tsc` reports no type errors in modified settings modules
- [ ] Creating `<workspace>/.beads/config.json` with valid `board.columns` causes board to display project-specific columns
- [ ] Removing project config file causes board to fall back to global columns
- [ ] `save-settings` with `scope: 'global'` writes to `~/.beads/config.json` and triggers board update
- [ ] `save-settings` with `scope: 'project'` writes to `<workspace>/.beads/config.json` and triggers board update
- [ ] Switching workspaces loads the correct project settings (or global fallback)
- [ ] Invalid project columns are filtered out and global defaults apply

### Phase 1
- [x] Board displays 5 columns on 1920px viewport without horizontal scrollbar
- [x] Board displays 8 columns with condensed cards (type badge hidden, reduced padding)
- [x] Horizontal scroll only appears when columns would be narrower than 180px
- [x] Cards show full meta at comfortable widths (> 260px per column)
- [x] Resizing browser window triggers column width recalculation and card class toggling
- [x] `npm test` passes with column width calculation tests
- [x] `@media (max-width: 1100px)` single-column fallback still works correctly

### Phase 2
- [ ] Column visibility dropdown appears in board filter bar with all columns checked by default
- [ ] Unchecking a column removes it from the board grid immediately
- [ ] `--board-columns` CSS variable updates to reflect visible count (responsive layout adapts)
- [ ] Visibility state persists across page reloads via localStorage
- [ ] Switching workspaces loads correct visibility state for that workspace
- [ ] Adding a new column via settings makes it visible by default in the filter
- [ ] Hidden columns still receive subscription updates (no data loss)

### Phase 3
- [ ] Navigating to `#/settings` displays the settings page with Global and Local tabs
- [ ] Global tab shows current columns in a sortable list and discovery settings
- [ ] Adding a column via the form creates a new entry in the list with all required fields
- [ ] Editing a column updates its properties in the list
- [ ] Deleting a column removes it from the list after confirmation
- [ ] Drag-to-reorder changes column order in the list
- [ ] Keyboard reorder (ArrowUp/Down on drag handle) works with screen reader announcements
- [ ] Selecting `status-issues` subscription shows the status param input; other types hide it
- [ ] Validation prevents duplicate IDs, empty required fields, and missing subscription-specific params
- [ ] Save button writes settings via WebSocket and board updates in real-time
- [ ] Reset button reverts to last saved state
- [ ] Local tab shows inherit/override radio; override mode enables the column editor
- [ ] Saving in override mode writes to project config file
- [ ] Switching back to "inherit" and saving removes project board columns override
- [ ] `npm test` passes with all settings UI tests
- [ ] `npm run tsc` and `npm run lint` clean

## Remaining Open Questions

1. Should the Settings UI display a "preview" of what the board would look like with the current column configuration? (decide before Phase 3 - nice to have, not blocking)
2. Should the column editor support bulk import/export of column definitions as JSON for power users? (decide before Phase 3 - could be deferred to a future PRD)

## Resolved Questions

| Question | Decision | Notes |
|----------|----------|-------|
| Which settings sections are project-overridable? | Board columns only | Server and discovery are global by nature |
| How should per-project override merge with global? | Complete replacement | Project columns fully replace global columns; no merging |
| Where does the Settings UI live? | `#/settings` route | Dedicated page, not a modal or panel |
| How does column visibility persist? | localStorage per workspace | Not in settings files; ephemeral per-browser |
| Should the board filter support reordering? | No, visibility only | Reorder belongs in Settings UI |
| What responsive approach for columns? | JS-calculated CSS variable | CSS alone cannot reference dynamic column count |
