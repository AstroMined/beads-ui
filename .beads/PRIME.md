# Beads Workflow Context

> Run `bd prime` after compaction, clear, or a new session (hooks do this automatically).

## SESSION CLOSE PROTOCOL

Before saying "done", run `bd dolt pull && bd dolt push` (pull first so the push is never
rejected non-fast-forward). Skip only when the project has no Dolt remote.

<!-- BEGIN PROJECT-LOCAL -->
<!-- Generated block. Do not edit here. Edit .beads/PRIME.local.md in this repo,
     then run ~/.claude/bin/render-prime.py --write. -->

**Git remote:** `https://github.com/AstroMined/beads-ui.git` (origin).
**Dolt remote:** `origin` -> `git+https://github.com/AstroMined/beads-ui.git`, verified configured. Bead history is stored as
the `refs/dolt/data` ref in that repository, out-of-band from the code branches.

<!-- END PROJECT-LOCAL -->

**Note:** Dolt auto-commit is enabled; every `bd` write is a Dolt commit.

## What a bead is

A bead is a short work order, not a document: what is wrong or missing and where, the approach
and what must not change, and pass/fail criteria that each say how they are proven. Point at
the PRD, doc, or file; do not restate it. Every bead follows bead format v1
(`~/.claude/hooks/bead_format.py`):

| Field       | Flag             | Holds                                                                                                 |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| Title       | `--title`        | one line of at least 3 characters, within bd's 500-byte title limit, no trailing `.`                  |
| Description | `--description`  | a header, then only `## Files`, `## Reads`, `## API`, `## PR sections`, in order, each once           |
| Design      | `--design`       | approach and constraints, free text                                                                   |
| Acceptance  | `--acceptance`   | one checkbox per line: run AC ``- [ ] `cmd` statement`` or settled AC `- [ ] statement`               |
| Notes       | `--append-notes` | one line each, `KIND: text`; `CONTEXT:` `DECISION:` `DEVIATION:` `OUTCOME:` `FINDING:` `OBSERVATION:` |

A run AC leads with its command in backticks; a settled AC is decided by reading. A `## Files`
bullet is exactly ``- `repo/relative/path` ``: no glob, `..`, absolute path or trailing prose. A
hand-filed bead about global config may name ``- `~/.claude/path` ``, written unexpanded.
Each type has one skeleton:

| Type            | Description header                 | `## Files` | Acceptance                                         |
| --------------- | ---------------------------------- | ---------- | -------------------------------------------------- |
| `task`, `chore` | why and what                       | required   | one or more ACs                                    |
| `bug`           | the symptom                        | required   | a run AC: the reproducing command, red at creation |
| `epic`          | goal                               | optional   | one or more ACs                                    |
| `feature`       | scope                              | optional   | none                                               |
| `observation`   | the finding, ``Reproduce: `cmd` `` | optional   | none                                               |

A bead you file by hand for work no PRD covers is not required to reference a PRD or a plan: its
header is free text, and every other rule above still applies. The `PRD:`, `Plan:` and `Source:` header lines belong
to beads the pipeline writes, and are checked only there, keyed on the bead's metadata: a
feature opened with `metadata.plan_key` carries `PRD: <path>`; an epic materialized with
`metadata.plan_sha` carries `PRD: <path> (<refs>)` and `Plan: <slug> @ <sha12>` and needs a run
AC; a task, chore or bug materialized with `metadata.plan_sha` has a header of exactly
`Plan: <epic>/<task> @ <sha12>` then `Source: <path>.md`. Pipeline features, epics and
observations are written by `~/.claude/bin/pipeline-check.py` (`feature-open`, `materialize`,
`observe`), never by hand.

### Writes the guard refuses

A PreToolUse hook (`~/.claude/hooks/bd-write-guard.py`) refuses, and shows you the reason; do
not route around it:

- `bd edit` (it opens an editor), `bd update --notes` (it replaces the whole field; use
  `--append-notes`), `bd import`, `bd sql`, and `bd create -f`/`--file`/`--graph`;
- an off-format write: a `bd create`, a `bd update` of title, description or acceptance, or a
  note that breaks bead format v1, named by its BF rule;
- content it cannot read: a `$VAR`, a `$(...)` that is not a quoted heredoc, `--stdin`, or a
  `--body-file`/`--design-file` not on disk. Write content inline or in a `<<'EOF'` heredoc.

`pipeline-check.py bead-lint <id>...` (or `--open`) checks existing beads against v1 and exits
3 on a violation; `--fix` rewrites what it can on open beads. Closed beads are never checked or
modified. A bead over about 64 KiB of JSON can only be closed, so keep beads short.

### Example

```bash
bd create --title="Add read-only DB connection wrapper" --type=task --priority=2 \
  --parent=proj-a1b.2 --description="$(cat <<'EOF'
Callers open raw connections and leak them on error (PRD-07 section 3.2).

## Files
- `src/pkg/db.py`
- `tests/unit/test_db.py`
EOF
)" \
  --design="Context manager over transport_sdk's client; no new retry logic." \
  --acceptance="$(cat <<'EOF'
- [ ] `uv run pytest tests/unit/test_db.py` wrapper closes on exception
- [ ] `make check-all` exits 0
- [ ] no caller outside src/pkg/db.py opens a raw connection
EOF
)"
bd update proj-a1b.2.1 --append-notes="DECISION: reuse the client's pool; no second pool"
bd close proj-a1b.2.1 --reason="Wrapper landed in a1b2c3d; unit and integration suites green."
```

### When to create a bead

- Substantive work the user asked for: multi-file code changes, bugs, anything spanning
  sessions or carrying dependencies.
- Not for: bead CRUD, single-doc or PRD edits, planning notes, formatting, config touches.
- Not for PRD-bound work: write the PRD first and file no feature, epic or task for it. The
  feature bead is created only when orchestrate plans the settled PRD
  (`pipeline-check.py feature-open --prd`), never by hand ahead of it.
- **Discovered work: fix, file, or report.** Something found while doing a bead is fixed
  now when it is within reach of the current bead. Otherwise it becomes a bead only when a
  command reproduces the failure; that command goes in a run AC, observed red at creation.
  An intermittent symptom does not exempt it: look for the deterministic defect underneath,
  and a command proving that cause counts. Anything with no reproducing command goes as one
  line under "Discovered, not done" in your final message, naming the suspected cause, and
  the user decides.
- One bead per unit of work. Do not split a task into per-file or per-finding beads.

## Essential commands

IDs are `<project>-<hash>`; children append `.N`. Always use full IDs (a short suffix is
ambiguous once an epic has children).

- `bd ready` / `bd list --status=open` / `bd show <id>` - find and read work
- `bd create --title="..." --type=task|bug|chore --priority=2 --parent=<id>` plus the v1
  fields (priority is `0-4`, never "high"/"low")
- `bd update <id> --status=in_progress` - claim; `--append-notes="DECISION: ..."` - record
- `bd close <id> --reason="..."` - always give a reason
- `bd dep add <issue> <depends-on>` - blocking dependency; `bd children <epic>`; `bd blocked`
- Never `bd edit` (opens `$EDITOR`); never `bd update --notes` (replaces the field)
- `bd dolt pull` then `bd dolt push` to sync

## Parent-child vs dependencies

- `--parent` is containment; `bd dep add` is ordering. Never dep-link a task to its own
  parent, and never wire a `blocks` edge from a bead onto its own ancestor (self-deadlock).
- **A `blocks` edge on a parent hides every child from `bd ready`** (bd 0.63.3). An empty
  `bd ready` is ambiguous: check `bd dep list <parent>` before concluding no work exists.
- Max four levels: feature -> epic -> task -> subtask.

## Reference

Types: `feature` (scope container), `epic`, `task`, `bug`, `chore`, `observation`. Statuses:
`open`, `in_progress`, `in_review` (custom; absent from `bd ready`, query with
`bd list --status=in_review`), `blocked`, `closed`.

A pipeline bead keeps its stage in metadata (`stage`); its status and assignee are derived from
type and stage (`~/.claude/hooks/bd_rules.py`), the assignee naming the actor that moves it
next. Only `pipeline-check.py advance` moves a stage; the guard refuses a raw `bd close` or
status change on a staged bead.

```text
feature      planning -> executing -> finalizing -> promoted
epic         planned -> admitted -> implementing -> verifying -> passed -> closed
             verifying <-> fixing; passed -> fixing when the merged tip is red
task         planned -> admitted -> implementing -> committed -> closed (bug, chore too)
             committed -> implementing on a redispatch; planned|admitted -> closed if superseded
observation  filed -> triaged -> closed | promoted
```

The lead may move any open feature, epic or task to `abandoned`. Find pipeline work with
`pipeline-check.py status <feature>` and `pipeline-check.py queue <feature>`, never
`bd ready --assignee=...` (transitive blocking makes empty output ambiguous).

Closed beads are not modified; create a new one. Reopen with `bd update <id> --status=open`.
