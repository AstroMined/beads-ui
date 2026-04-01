# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

## SESSION CLOSE PROTOCOL

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. git status              (check what changed)
[ ] 2. git add <files>         (stage code changes)
[ ] 3. git commit -m "..."     (commit code)
[ ] 4. git push                (push to remote)
```

**NEVER skip this.** Work is not done until pushed.

**Note:** Remote configured at `origin` (AstroMined/beads-ui fork). Push to `develop` branch.

## Core Rules

- Track strategic work in beads (multi-session, dependencies, discovered work)
- Any committed code or documentation change MUST have a bead - no exceptions
- When in doubt, prefer bd - persistence you don't need beats lost context
- Session management: check `bd ready` for available work

---

## Project Context

- **Project**: beads-ui (local UI for the `bd` CLI)
- **Language**: JavaScript (ESM) with TypeScript type checking
- **Build**: esbuild, vitest for tests, eslint + prettier for linting
- **Node**: >= 22
- **Issue prefix**: beads-ui

## Branching Strategy

- **`main`** - Stays in sync with upstream (`mantoni/beads-ui`). Used as base for upstream PRs. Do NOT commit workflow files here.
- **`develop`** - Working branch with our workflow files (`.beads/`, `PRIME.md`, `CLAUDE.md`). All daily work happens here.
- **Upstream PRs**: Branch off `main`, use `git checkout develop -- <files>` to selectively pull code changes, then PR to `mantoni/beads-ui`.

---

## Issue Quality Requirements

### The Four Content Fields

Every issue has four structured fields. **Use all relevant fields, not just `--description`.**

| Field           | Flag            | Purpose                               | When to Use        |
| --------------- | --------------- | ------------------------------------- | ------------------ |
| **Description** | `--description` | Files, checklist, overview            | Always             |
| **Design**      | `--design`      | Architecture, approach, code patterns | Complex tasks      |
| **Notes**       | `--notes`       | Progress, decisions, gotchas          | As you work        |
| **Acceptance**  | `--acceptance`  | Pass/fail criteria, test commands     | **ALL leaf tasks** |

### Field Usage by Hierarchy Level

| Level                   | Description                     | Design               | Notes               | Acceptance       |
| ----------------------- | ------------------------------- | -------------------- | ------------------- | ---------------- |
| **Feature**             | PRD scope, epic overview        | -                    | Pipeline metadata   | -                |
| **Epic**                | Phase scope, overview           | -                    | -                   | -                |
| **Task/Session**        | Session scope, overview         | Ordering rationale   | Dependencies        | -                |
| **Subtask/Component**   | Files, implementation checklist | Architecture pattern | -                   | Test commands    |
| **Sub-subtask/Concern** | Specific implementation         | Code patterns        | Gotchas, edge cases | Concern-specific |

**MANDATORY: ALL leaf tasks (tasks with no children) MUST include `--acceptance`** with criteria
specific to that task's scope. Subtasks get test commands; sub-subtasks get concern-specific criteria.

### Note Prefixes (Cross-Session Memory)

Notes are **memory for future sessions**. Always use structured prefixes:

| Prefix       | When to Use                       | Example                                                     |
| ------------ | --------------------------------- | ----------------------------------------------------------- |
| `CONTEXT:`   | Creating tasks, background        | `CONTEXT: Relates to Phase 1 auth work`                     |
| `DECISION:`  | Design choices with reasoning     | `DECISION: Used html-to-markdown - better tables`           |
| `DEVIATION:` | Intentional differences from spec | `DEVIATION: Skipped retry logic - not needed for sync`      |
| `OUTCOME:`   | Completion results, test status   | `OUTCOME: All 15 tests passing. Coverage: 87%. Mypy clean.` |
| `FINDING:`   | Investigation results             | `FINDING: Root cause is race condition in worker pool`      |

**When to add notes:**

1. **Creating tasks:** Add `CONTEXT:` about related work
2. **Implementing:** Add `DECISION:` for non-obvious choices, `DEVIATION:` for spec changes
3. **Completing:** Add `OUTCOME:` with verification results

### Self-Contained Descriptions

**Rule: A future session must understand the task using ONLY `bd show <id>`.**

**BAD** (shallow placeholder - forces re-reading specs every session):

```bash
bd create --title="Feature implementation" \
  --description="Library integration, multi-source scanning"
```

**GOOD** (self-contained - implementable from `bd show` alone):

```bash
bd create --title="Feature implementation" --type=task --parent=<epic-id> \
  --description="$(cat <<'EOF'
## Files
- `lib/feature.js`
- `test/feature.test.js`

## Implementation
- [ ] Feature module following existing patterns in lib/
- [ ] Integration with express routes
- [ ] WebSocket event handling

## Tests
- [ ] Unit tests with vitest
EOF
)" \
  --acceptance="$(cat <<'EOF'
- [ ] `npm test` passes
- [ ] `npm run tsc` passes
- [ ] `npm run lint` passes
EOF
)"
```

### Rich Close Reasons

**Always close with `--reason` containing an OUTCOME.** Close reasons survive compaction
and provide context for future sessions.

```bash
bd close <id> --reason="$(cat <<'EOF'
## OUTCOME
Successfully implemented feature X.

### Changes Made
1. Created lib/feature.js with handler pattern
2. Added tests in test/feature.test.js

### Verification
- All tests passing
- tsc clean, eslint clean
EOF
)"
```

---

## Essential Commands

### ID Format

Beads IDs are `beads-ui-<hash>` (e.g., `beads-ui-abc`). Children append `.N`
(e.g., `beads-ui-abc.1`). **Always use full IDs in `bd` commands.**

### Finding Work

- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating

- `bd create --title="..." --type=task|bug|feature --priority=2` - New issue
  - Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low"
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --title/--description/--notes/--design/--acceptance` - Update fields inline
- `bd close <id> --reason="OUTCOME: ..."` - Close with rich reason (**ALWAYS include --reason**)
- **WARNING**: Do NOT use `bd edit` - it opens $EDITOR which blocks agents

### Dependencies & Blocking

- `bd dep add <issue> <depends-on>` - Add blocking dependency (issue waits for depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Persistence

JSONL auto-persistence is enabled. All `bd` writes update `.beads/issues.jsonl` automatically.

### Project Health

- `bd stats` - Project statistics (open/closed/blocked counts)
- `bd doctor` - Check for issues (sync problems, missing hooks)

---

## Common Workflows

**Starting work:**

```bash
bd ready                                 # Find available work
bd show <id>                             # Review issue details
bd update <id> --status=in_progress      # Claim it
```

**Completing work:**

```bash
bd close <id> --reason="Implemented feature X with tests. OUTCOME: tests passing."
git add <files> && git commit -m "..."   # Commit code changes
git push                                 # Push to remote
```

**Bug investigation (MANDATORY - create bug FIRST before any diagnostics):**

```bash
# 1. Create bug IMMEDIATELY (before investigation)
bd create --title="Bug: <description>" --type=bug

# 2. Claim it
bd update <new-id> --status=in_progress

# 3. NOW investigate (add findings as notes)
bd update <id> --append-notes="FINDING: Root cause is..."

# 4. Close when fixed
bd close <id> --reason="Fixed by <change>. OUTCOME: Tests pass."
```

---

## Reference

### Issue Types

| Type      | When to Use                                                    |
| --------- | -------------------------------------------------------------- |
| `feature` | PRD implementation container (parent of epics in the pipeline) |
| `epic`    | Large work container spanning multiple tasks                   |
| `task`    | Discrete deliverable with clear completion                     |
| `bug`     | Defect, unexpected behavior, investigation                     |
| `chore`   | Maintenance, cleanup, no user-facing change                    |

### Priority Levels

| Priority | Meaning           |
| -------- | ----------------- |
| 0 (P0)   | Critical/blocking |
| 1 (P1)   | High priority     |
| 2 (P2)   | Normal (default)  |
| 3 (P3)   | Low priority      |
| 4 (P4)   | Backlog           |

### What Survives Compaction

When bd compacts old issues, it preserves: **Title, Description, Close reason, Notes**.
Write these fields as if explaining to someone with no conversation history.
