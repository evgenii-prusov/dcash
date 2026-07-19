# DCash — household finance tracker

Multi-currency household finance for **[dengi.dev](https://dengi.dev)**:
accounts in EUR/USD/RUB, income & expense records, transfers between
accounts (including cross-currency), budgets, recurring transactions and
EUR-based reports — for multiple invite-gated households.

- **Specification:** [`docs/spec.md`](docs/spec.md) — scope, domain model,
  API, FX handling, deployment. The source of truth.
- **Design system:** [`docs/design-system.md`](docs/design-system.md) —
  ported from the sibling [dtasks](https://github.com/evgenii-prusov/dtasks)
  project, whose stack and approach this repo deliberately mirrors.
- **Issue tracking:** [beads](https://github.com/gastownhall/beads) (`bd`),
  prefix `dcash`; milestone epics in spec §12.

## Stack

- **Backend:** Python, [Litestar](https://litestar.dev), SQLAlchemy 2
  (async), SQLite, Alembic
- **Frontend:** React 19, TypeScript, TanStack Router + Query,
  Tailwind CSS 4, Vite, i18next (EN/RU)

## Development

```sh
make install        # uv sync + npm install
make start          # backend :8000 + frontend :5173 in the background
make test           # pytest + vitest
make help           # everything else
```

## Production

Single Docker image (built frontend served by Litestar) on a shared Oracle
Cloud VM behind the [dinfra](https://github.com/evgenii-prusov/dinfra)
Caddy edge. See spec §10; full deploy runbook lands with the deploy epic.
