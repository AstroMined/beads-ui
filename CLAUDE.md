# beads-ui - Project Instructions

## Fork Information

This is a fork of [mantoni/beads-ui](https://github.com/mantoni/beads-ui).
Upstream remote is configured as `upstream`.

## Branching Strategy

### Branch Roles

- **`main`** - Mirrors upstream. Contains the author's original workflow files (`.beads/`, `.github/`, `AGENTS.md`). Used exclusively as a base for upstream PRs. Do NOT commit our workflow files here.
- **`develop`** - Our working branch. Author's workflow files removed, replaced with our own Beads setup, `PRIME.md`, and this `CLAUDE.md`. All daily work happens here.

### Syncing with Upstream

```bash
git fetch upstream
git checkout main
git merge upstream/main
git checkout develop
git merge main
```

### Submitting PRs to Upstream

When fixing bugs or adding features to contribute back to `mantoni/beads-ui`:

1. Work on `develop` using our full workflow (Beads, etc.)
2. When ready to PR, create a branch off `main`:
   ```bash
   git checkout main
   git checkout -b fix/descriptive-name
   ```
3. Selectively pull only code changes from `develop`:
   ```bash
   git checkout develop -- path/to/changed/file.js path/to/other/file.js
   ```
4. Commit and push the clean branch, then PR to `mantoni/beads-ui`

### Tracked files (committed to git)

- `CLAUDE.md` - project instructions
- `.claude/` - project configuration (settings, commands)
- `.beads/` - issue tracker (general-purpose, not AI-specific)

These files are tracked on the `develop` branch. The Main/Upstream protection still applies to the fork's branch strategy: do not push our `develop`-specific content to `main` when preparing upstream PRs. When cherry-picking code changes for upstream PRs, exclude these workflow files.

The author's original `.beads/`, `.github/`, and `AGENTS.md` remain on `main` to avoid conflicts with upstream.

## Tech Stack

- **Language**: JavaScript (ESM) with TypeScript type checking
- **Runtime**: Node.js >= 22
- **Build**: esbuild
- **Tests**: vitest
- **Lint**: eslint + prettier
- **Key deps**: express, lit-html, marked, ws, dompurify

## Issue Tracking (Beads)

This project uses [Beads](https://github.com/steveyegge/beads) (`bd` CLI) for issue tracking.
Persistence uses the embedded Dolt backend with auto-commit enabled. See `.beads/PRIME.md` for
full workflow details.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
```

## Validation Commands

```bash
npm test          # Run tests
npm run tsc       # Type check
npm run lint      # Lint
npm run prettier  # Format check
```
