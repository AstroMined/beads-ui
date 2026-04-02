# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when .beads/ detected

## SESSION CLOSE PROTOCOL

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```text
[ ] 1. git status              (check what changed)
[ ] 2. git add <files>         (stage code changes + .beads/issues.jsonl)
[ ] 3. git commit -m "..."     (commit code)
[ ] 4. git push                (push to remote)
```

<!-- REMOTE: Push-enabled -- public GitHub (github.com) -->
**Note:** Git remote configured. Always push at session end. Work is not done until pushed.
**Note:** Dolt auto-commit is enabled. All `bd` writes create Dolt commits automatically.

## Core Rules

- Track strategic work in beads (multi-session, dependencies, discovered work)
- Any committed code or documentation change MUST have a bead - no exceptions
- When in doubt, prefer bd - persistence you don't need beats lost context
- Session management: check `bd ready` for available work

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
| ----------------------- | ------------------------------- | -------------------- | -------------------- | ---------------- |
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
- `src/project/feature.py`
- `tests/unit/test_feature.py`

## Implementation
- [ ] Feature class following BaseAdapter[Config] pattern
- [ ] Library integration
- [ ] Multi-source scanning from config
- [ ] Metadata extraction

## Tests
- [ ] Use real test data (no mocks)
EOF
)" \
  --design="Architecture follows BaseAdapter[Config] generic pattern." \
  --acceptance="$(cat <<'EOF'
- [ ] `uv run pytest tests/unit/test_feature.py` passes
- [ ] `uv run mypy src/project/feature.py` passes
EOF
)"
```

### Complete Four-Field Example

```bash
bd create --title="GitAdapter implementation" --type=task --parent=<epic-id> \
  --description="$(cat <<'EOF'
## Files
- `src/project/sources/git.py`
- `tests/unit/sources/test_git.py`

## Implementation
- [ ] GitAdapter class following SourceAdapter[GitConfig] pattern
- [ ] GitPython integration
- [ ] Multi-repo scanning
EOF
)" \
  --design="$(cat <<'EOF'
## Architecture
Follows `SourceAdapter[GitConfig]` generic pattern.

## Entry Point
[project.entry-points."project.sources"]
git = "project.sources.git:GitAdapter"
EOF
)" \
  --notes="CONTEXT: Use committed_date (unix timestamp), NOT authored_date" \
  --acceptance="$(cat <<'EOF'
- [ ] `uv run pytest tests/unit/sources/test_git.py` passes
- [ ] `uv run mypy src/project/sources/git.py` passes
EOF
)"
```

### Sub-subtask Example (Concern-Level)

Sub-subtasks capture a single implementation concern with code patterns and gotchas:

```bash
bd create --title="Timestamp handling" --parent=<subtask-id> \
  --description="Convert commit timestamps to timezone-aware UTC" \
  --design="$(cat <<'EOF'
from datetime import datetime, timezone

created_dt = datetime.fromtimestamp(
    commit.committed_date,
    tz=timezone.utc
)
EOF
)" \
  --notes="CONTEXT: commit.committed_date is Unix epoch (int). Always attach timezone."
```

### Rich Close Reasons

**Always close with `--reason` containing an OUTCOME.** Close reasons survive compaction
and provide context for future sessions.

```bash
bd close <id> --reason="$(cat <<'EOF'
## OUTCOME
Successfully implemented feature X.

### Changes Made
1. Created src/project/feature.py with base pattern
2. Added tests in tests/unit/test_feature.py

### Verification
- All 12 tests passing
- Coverage: 87%
- Mypy clean, Ruff clean

### Notes
- DECISION: Used approach X because Y
- Deferred Z to future task <epic-id>.3
EOF
)"
```

**Closing patterns:**

```bash
# Successful completion (always include OUTCOME)
bd close <id> --reason="Completed: description. OUTCOME: Tests pass, coverage 85%."

# Won't fix / Deferred
bd close <id> --reason="Deferred: reason for deferral. Moving to <other-id>."

# Duplicate
bd close <id> --reason="Duplicate of <other-id>"

# Created in error
bd close <id> --reason="Created in error: explanation"
```

### Pre-Creation Checklist

Before running `bd create`, verify you have:

- [ ] **Title**: Clear, actionable summary
- [ ] **Description**: Files, implementation checklist, context (self-contained)
- [ ] **Acceptance** (leaf tasks): Testable pass/fail criteria
- [ ] **Design** (complex tasks): Architecture, approach, code patterns

---

## Essential Commands

### ID Format

Beads IDs are `<project>-<hash>` (e.g., `myproject-abc`). Children append `.N`
(e.g., `myproject-abc.1`). **Always use full IDs in `bd` commands.** Short suffixes
like `-abc` cause ambiguity errors when an epic has children, because `-abc` matches
the epic and all of its children simultaneously. Copy IDs directly from `bd ready`
or `bd list` output rather than abbreviating.

### Finding Work

- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating

- `bd create --title="..." --type=task|bug|feature --priority=2` - New issue
  - Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low"
- `bd update <id> --status=in_progress` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
- `bd update <id> --title/--description/--notes/--design/--acceptance` - Update fields inline
- `bd close <id> --reason="OUTCOME: ..."` - Close with rich reason (**ALWAYS include --reason**)
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency
- **WARNING**: Do NOT use `bd edit` - it opens $EDITOR (vim/nano) which blocks agents

### Dependencies & Blocking

- `bd dep add <issue> <depends-on>` - Add blocking dependency (issue waits for depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Persistence

Embedded Dolt with auto-commit enabled. Every `bd` write creates a Dolt commit
automatically. Data is durable immediately. For projects with a Dolt remote,
run `bd dolt push` to sync changes to other machines.

### Project Health

- `bd stats` - Project statistics (open/closed/blocked counts)

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
# Add OUTCOME note before closing
bd update <id> --append-notes="OUTCOME: All tests pass. Coverage 85%. Mypy clean."

# Close with rich reason
bd close <id> --reason="Implemented feature X with tests. OUTCOME: 12 tests passing, coverage 85%."
```

**Bug investigation (MANDATORY - create bug FIRST before any diagnostics):**

```bash
# 1. Create bug IMMEDIATELY (before investigation)
bd create --title="Bug: <description>" --type=bug --parent=<epic-id>

# 2. Claim it
bd update <new-id> --status=in_progress

# 3. NOW investigate (add findings as notes)
bd update <id> --append-notes="FINDING: Root cause is..."

# 4. Close when fixed
bd close <id> --reason="Fixed by <change>. OUTCOME: Tests pass."
```

**Creating an epic with child tasks (HIERARCHICAL):**

```bash
# 1. Create the parent epic
bd create --title="Epic name" --type=epic
# Returns: <epic-id>

# 2. Create child tasks using --parent flag
bd create --title="Task 1" --type=task --parent=<epic-id>
bd create --title="Task 2" --type=task --parent=<epic-id>
# Returns: <epic-id>.1, <epic-id>.2, etc.

# 3. View children of an epic
bd children <epic-id>
```

**Adding blocking dependencies (between siblings):**

```bash
# Task 2 cannot start until Task 1 completes
bd dep add <epic-id>.2 <epic-id>.1
```

---

---

## Parent-Child vs Dependencies

| Relationship            | How to Create                    | Effect                                                                                  |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| **Parent-child**        | `--parent=<epic-id>` on create   | Hierarchical containment. IDs are `epic.1`, `epic.2`. Children appear in `bd children`. |
| **Blocking dependency** | `bd dep add <blocked> <blocker>` | Execution order. Blocked issue hidden from `bd ready` until blocker closes.             |

### Dependency Types

| Type              | Effect                                                          |
| ----------------- | --------------------------------------------------------------- |
| `blocks`          | Hard dependency - blocked task can't start until blocker closes |
| `related`         | Soft connection (informational only)                            |
| `parent-child`    | Hierarchical (auto-created with `--parent`)                     |
| `discovered-from` | Provenance - task found while working on another                |

### Critical Gotcha: Parent-Child is NOT Blocking

**`parent-child` is NOT a blocking relationship.** Children appear in `bd ready` even if
their parent is incomplete or blocked.

| Dependency Type | Effect on `bd ready`                                    |
| --------------- | ------------------------------------------------------- |
| `parent-child`  | Child tasks CAN be ready even if parent is incomplete   |
| `blocks`        | Blocked task won't appear in ready until blocker closes |

**Implication:** If you want "nothing in Session B can start until Session A completes":

- You must add `blocks` dependencies from Session A to EACH of B's subtasks
- Just blocking the parent Session B is NOT sufficient
- Children of a blocked parent are still ready to work on

```
WRONG:  Session A blocks Session B
        └── But B.1, B.2, B.3 are still READY!

RIGHT:  Session A blocks B.1, B.2, B.3 individually
        └── Now none of B's children appear in `bd ready`
```

**Key distinctions:**

- Use `--parent` when tasks BELONG TO an epic (hierarchical structure)
- Use `bd dep add` when one task MUST COMPLETE BEFORE another can start (blocking)
- Do NOT use `bd dep add` to link tasks to their parent epic - use `--parent` when creating

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

In the pipeline, the hierarchy is: **Feature -> Epic -> Task/Bug**. Feature beads
are created by `prepare-feature` and contain PRD path, feature branch, and parent
branch metadata in CONTEXT: notes.

### Priority Levels

| Priority | Meaning           |
| -------- | ----------------- |
| 0 (P0)   | Critical/blocking |
| 1 (P1)   | High priority     |
| 2 (P2)   | Normal (default)  |
| 3 (P3)   | Low priority      |
| 4 (P4)   | Backlog           |

Use numeric 0-4 or P0-P4 format. Do NOT use "high"/"medium"/"low".

### Status Values

| Status        | Meaning                                           |
| ------------- | ------------------------------------------------- |
| `open`        | Not started                                       |
| `in_progress` | Currently being worked on                         |
| `in_review`   | Implemented, awaiting code review or validation   |
| `blocked`     | Waiting on dependency                             |
| `closed`      | Completed                                         |

The `in_review` status is a custom status (setup: `bd config set status.custom "in_review"`).
It does NOT appear in `bd ready` output. Query it explicitly: `bd list --status=in_review`.

### Assignee Routing (Pipeline)

When working within the implementation pipeline, the `assignee` field acts as a
dispatch queue. Each skill checks for work assigned to it and routes completed
work to the next skill:

```
prepare-feature -> sets assignee=prepare-epic on new epics
prepare-epic    -> sets assignee=implement-epic on completion
implement-epic  -> sets status=in_review, assignee=finalize-epic
finalize-epic   -> sets assignee=finalize-feature (pass) or implement-epic (fail)
finalize-feature -> closes beads (clean) or creates new epics (remediation)
```

Query patterns:
- `bd ready --assignee=prepare-epic` - epics awaiting preparation
- `bd ready --assignee=implement-epic` - epics ready for implementation
- `bd list --status=in_review --assignee=finalize-epic` - epics awaiting review
- `bd list --status=in_review --assignee=finalize-feature` - epics awaiting validation

### What Survives Compaction

When bd compacts old issues, it preserves: **Title, Description, Close reason, Notes**.
Write these fields as if explaining to someone with no conversation history.

---

## Best Practices

### DO

- Write self-contained descriptions (files, checklist, tests, acceptance)
- Use all four content fields appropriately (not just `--description`)
- Always provide `--reason` when closing (with OUTCOME)
- Update notes with prefixes as if explaining to a future agent with zero context
- Create a bead for every bug, every code change, and every documentation change - if it gets committed, it gets a bead
- Create discovered issues immediately - don't lose context
- Check `bd ready` at session start and after closing tasks
- Use `--json` for machine-parseable output
- Use heredocs (`cat <<'EOF'`) for multi-line field content

### DON'T

- Don't skip bead creation because a change feels "small" or "trivial" - if it's committed, it needs a bead
- Don't forget to claim tasks with `in_progress` before starting
- Don't close without `--reason` - future sessions need context
- Don't create more than 4 levels (feature -> epic -> task -> subtask)
- Don't create shallow placeholder descriptions that just reference spec files
- Don't put everything in `--description` - use `--design`, `--notes`, `--acceptance`
- Don't modify issues that are closed/tombstoned (create new ones instead)

---

## Troubleshooting

### "No ready issues" but work exists

```bash
bd list --status=open --json   # Check if everything is blocked
bd dep tree <id>               # See what's blocking
```

### Need to re-parent an issue

```bash
bd update <id> --parent=<new-parent-id>
```

### Accidentally closed wrong issue

```bash
bd update <id> --status=open   # Reopen it
```

---

## External Resources

- [Beads GitHub Repository](https://github.com/steveyegge/beads)
- [beads-ui Kanban Board](https://github.com/mantoni/beads-ui)
- [Beads Guide | Better Stack](https://betterstack.com/community/guides/ai/beads-issue-tracker-ai-agents/)
