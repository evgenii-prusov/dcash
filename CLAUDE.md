# DCash — household finance tracker (dengi.dev)

Multi-currency (EUR/USD/RUB, base EUR) household income/expense/transfer
tracker for multiple invite-gated households. **Read `docs/spec.md` first** —
it is the source of truth for scope, domain model, API, FX handling and
deployment; `docs/design-system.md` holds the visual system (ported from the
sibling dtasks project). Beads issue prefix: `dcash`; milestone epics map to
spec §12.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

Makefile mirrors dtasks (arrives with the scaffolding epic): `make install`,
`make test`, `make dev-backend` (Litestar on :8000), `make dev-frontend`
(Vite on :5173, proxies `/api`), `make start/stop/status/logs`.

## Architecture Overview

- Stack mirrors **dtasks** (`../dtasks` is the reference implementation):
  Python 3.11+ / Litestar 2 / SQLAlchemy 2 async / SQLite / Alembic in
  `backend/`; React 19 / TypeScript / Vite / TanStack Router+Query /
  Tailwind 4 / i18next EN+RU in `frontend/`.
- Single Docker image (frontend built into static files served by Litestar),
  deployed to the existing Oracle VM behind the shared Caddy edge that lives
  in its own repo (`evgenii-prusov/dinfra`, cloned to `~/dinfra` on the VM,
  live and serving dtasks.dev since 2026-07-19), domain **dengi.dev**.
  Read spec §10 before touching deploy.

## Conventions & Patterns

- Money amounts: **integers in minor units + 3-letter currency code. Never
  floats.** Conversion via the rates table at read time only (spec §4).
- Every domain query is scoped by the session user's `household_id`.
- Env vars are prefixed `DCASH_`.
- Feature branches + PRs; no direct commits to `main`.
- When porting from dtasks, prefer copying its proven code/patterns over
  reinventing (auth, backup script, CD workflow, Makefile, app shell).
- Load the `dataviz` skill before writing any chart code.
