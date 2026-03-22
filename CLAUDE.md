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

### Files That Must NEVER Go to Main or Upstream

- `.beads/PRIME.md` (our workflow config)
- `CLAUDE.md` (this file)
- Any files in `.beads/` that we create
- `AGENTS.md` (if we regenerate one)

The author's original `.beads/`, `.github/`, and `AGENTS.md` remain on `main` to avoid conflicts with upstream.

## Tech Stack

- **Language**: JavaScript (ESM) with TypeScript type checking
- **Runtime**: Node.js >= 22
- **Build**: esbuild
- **Tests**: vitest
- **Lint**: eslint + prettier
- **Key deps**: express, lit-html, marked, ws, dompurify

## Validation Commands

```bash
npm test          # Run tests
npm run tsc       # Type check
npm run lint      # Lint
npm run prettier  # Format check
```
