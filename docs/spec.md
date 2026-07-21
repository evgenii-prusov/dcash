# DCash — specification (v1)

Household finance tracker at **https://dengi.dev**: accounts in several
currencies, income/expense records, transfers between accounts, budgets,
recurring transactions and reports — for multiple invite-gated households.

Sibling project: [dtasks](https://github.com/evgenii-prusov/dtasks) — DCash
deliberately mirrors its stack, project layout, auth design, deployment
pipeline and design system (extracted in [`design-system.md`](design-system.md)).
Both apps run on the same Oracle Cloud VM behind one shared Caddy.

Work is tracked in **beads** (`bd`), issue prefix `dcash`. Milestones (§12)
map 1:1 to beads epics.

---

## 1. Decisions log (owner Q&A, 2026-07-19)

| Topic          | Decision |
| -------------- | -------- |
| Tenancy        | Multi-household: signup is invite-gated (global code); each signup creates an isolated household; members join an existing household via a join code |
| Currencies     | EUR, USD, RUB at launch; adding a currency is a data change, not a code change |
| Base currency  | EUR — all totals, budgets and reports convert into EUR; account balances always shown in native currency too |
| FX rates       | Auto daily rates stored per date (historical accuracy); manual override wins; cross-currency transfers record real amounts on both sides |
| v1 features    | Reports & charts, budgets, recurring transactions. CSV bank import **not** in v1 |
| Categories     | Two-level: groups → subcategories, editable, seeded defaults |
| Migration      | One-time importer for **ZenMoney** export |
| Entry device   | Desktop-first (same app-shell approach as dtasks); mobile usable but not optimized |
| Auth           | Port dtasks auth: email+password, argon2, invite code, optional Google/GitHub OAuth, server-side sessions; plus household join codes |
| VM topology    | Shared Caddy: standalone edge compose project owns 80/443; dtasks and dcash join a shared docker network. Edge config lives in its own tiny repo, [`evgenii-prusov/dinfra`](https://github.com/evgenii-prusov/dinfra) — **live since 2026-07-19** |
| App name       | **DCash** (UI wordmark), domain dengi.dev |
| Repo           | `evgenii-prusov/dcash` on GitHub, public (same as dtasks; flip to private anytime — no user data ever lives in the repo) |

## 2. Tech stack (mirrors dtasks)

- **Backend:** Python 3.11+, Litestar 2, SQLAlchemy 2 (async) + aiosqlite,
  SQLite, Alembic migrations, argon2-cffi, httpx. Tests: pytest + respx. Lint: ruff.
- **Frontend:** React 19, TypeScript, Vite, TanStack Router + Query,
  Tailwind CSS 4 (CSS-first config), i18next (EN/RU), @fontsource fonts.
  Tests: vitest + testing-library, Playwright e2e. Lint: oxlint.
- **Charts:** recharts, colored from design tokens (load the `dataviz` skill
  before writing any chart code).
- **Deploy:** single Docker image (frontend built into static files served by
  Litestar with SPA fallback), docker compose on the existing Oracle A1 Flex
  VM (ARM64), shared Caddy for HTTPS, GitHub Actions CD → ghcr.io → SSH deploy.
- **Repo layout:** `backend/`, `frontend/`, `docs/`, `scripts/`, `Makefile`,
  `Dockerfile`, `docker-compose.yml` — same shape as dtasks. The shared Caddy
  edge is NOT in this repo — it has its own (`dinfra`, §10).

## 3. Domain model

All money amounts are **integers in minor units** (cents/kopecks) stored next
to a 3-letter currency code. Never floats. EUR/USD/RUB all have 2 decimals;
the `currencies` table records decimals per code for future currencies.
Formatting is done client-side with `Intl.NumberFormat`.

Every domain row is scoped by `household_id`; every query filters by the
session user's household (same ownership-check pattern as dtasks).

| Table | Fields (beyond id / household_id / created_at) |
| ----- | ---------------------------------------------- |
| `users` | email (unique, lowercased), password_hash, created_at — as dtasks |
| `oauth_accounts` | ported from dtasks OAuth design (`docs/auth.md` §2 there) |
| `households` | name |
| `household_members` | user_id (unique — a user belongs to exactly one household in v1), role `owner\|member`, joined_at |
| `household_invites` | code (random, unique), created_by, expires_at (7 days), used_by, used_at — single-use join codes |
| `currencies` | code (PK), decimals, symbol — seeded EUR/USD/RUB, global |
| `accounts` | name, type `checking\|savings\|cash\|card\|deposit\|other`, currency, opening_balance_minor, archived, sort_order. Balance is derived: opening + Σ(transactions) ± Σ(transfers). Negative balances allowed (credit cards) |
| `category_groups` | name, kind `expense\|income`, sort_order |
| `categories` | group_id, name, archived, sort_order |
| `transactions` | account_id, category_id, kind `expense\|income` (denormalized = group kind), amount_minor (>0), currency (copied from account), date, payee (nullable), note, created_by, recurring_rule_id (nullable), import_batch_id (nullable), split_group_id (nullable — a split is N sibling rows sharing this id, equal to the first row's own id; not a parent row, not a child table; presentation metadata only, so balances, the category rollup, net worth and budgets stay unaffected) |
| `transfers` | from_account_id, to_account_id, from_amount_minor, to_amount_minor, date, note, created_by, import_batch_id. Same-currency: amounts equal by default. Cross-currency: both real amounts entered → implied rate. A transfer fee is recorded as a separate expense transaction |
| `rates` | date, currency, rate_to_eur (TEXT, parsed with `Decimal`), source `auto\|manual`; PK (date, currency) |
| `budgets` | category_id, month (`YYYY-MM`), amount_minor — **always EUR**; unique (category_id, month) |
| `recurring_rules` | kind `expense\|income\|transfer`, template payload (account(s), category, amount(s), payee, note), freq `monthly\|weekly\|yearly`, day spec, next_run (date), active |
| `import_batches` | source (`zenmoney`), stats JSON — enables idempotent re-import and one-click undo |

Seeded default categories (RU/EN names, editable): Housing (Rent, Utilities),
Food (Groceries, Restaurants), Transport (Public transport, Car, Taxi),
Health (Pharmacy, Doctors, Sport), Personal (Clothes, Subscriptions, Gifts),
Leisure (Travel, Entertainment), Other; income groups: Salary, Freelance,
Interest, Other income.

## 4. Currency conversion (FX)

- **Storage:** one row per (date, currency) with the EUR rate for that day.
- **Providers** (free, keyless, fetched with httpx behind a provider interface):
  - [frankfurter.app](https://frankfurter.app) — ECB reference rates, daily +
    full history. Covers USD (and most future currencies). **No RUB after
    2022-03** — which is why a second provider exists.
  - CBR (`cbr.ru` XML: `XML_daily` / `XML_dynamic`) — RUB official rates,
    daily + history. RUB→EUR is derived from CBR's EUR-in-RUB quote.
- **Fetch:** lazily on the first authenticated request of a day (plus a
  manual "Refresh rates" button in Settings). Backfill: importer and reports
  request historical ranges on demand; fetched rates are cached forever in
  the table.
- **Lookup rule:** for date D use the rate at D, else the nearest previous
  date with a rate (weekends/holidays). Manual overrides (`source=manual`)
  always win over auto rows for the same (date, currency).
- **Conversion:** at read time, in Python `Decimal`, half-even rounding to
  minor units. Nothing converted is ever persisted — reports always derive
  from raw amounts + the rates table, so a corrected rate retroactively fixes
  reports.

## 5. API sketch

Auth endpoints are ported verbatim from dtasks (`docs/auth.md` there):
signup/login/logout/me + OAuth start/callback/providers, rate-limited,
sessions in a server-side FileStore, 30-day cookie. Signup takes the global
`DCASH_INVITE_CODE` **or** a household join code (then the user joins that
household as `member` instead of creating a new one).

| Area | Endpoints |
| ---- | --------- |
| Household | `GET/PATCH /api/household` · `GET /api/household/members` · `DELETE /api/household/members/{user_id}` (owner) · `POST /api/household/invites` → `{code, expires_at}` · `DELETE /api/household/invites/{id}` |
| Accounts | `GET/POST /api/accounts` · `PATCH /api/accounts/{id}` (rename, archive, opening balance, sort) |
| Categories | `GET /api/categories` (groups nested) · `POST/PATCH /api/category-groups[/{id}]` · `POST/PATCH /api/categories[/{id}]` |
| Ledger | `GET /api/ledger?month=&account_id=&category_id=&q=` — merged, date-sorted stream of transactions and transfers with a `type` discriminator; month-paged |
| Transactions | `POST /api/transactions` · `PATCH/DELETE /api/transactions/{id}` · `POST /api/transactions/{id}/split` (split an existing row into N category lines) · `POST /api/transactions/splits` (create an already-split entry from scratch) · `DELETE /api/transactions/splits/{id}` (delete a split group) · `GET /api/transactions/payees` (merchant history for autocomplete) |
| Transfers | `POST /api/transfers` · `PATCH/DELETE /api/transfers/{id}` |
| Rates | `GET /api/rates?date=` · `PUT /api/rates/{date}/{currency}` (manual override) · `POST /api/rates/refresh` |
| Reports | `GET /api/reports/summary?month=` (income, expenses, net, per-account balances — native + EUR) · `GET /api/reports/categories?month=&kind=` (group→category rollup) · `GET /api/reports/net-worth?from=&to=` (monthly points, month-end rates) |
| Budgets | `GET /api/budgets?month=` (limit + spent + remaining per category) · `PUT /api/budgets/{month}/{category_id}` · `POST /api/budgets/{month}/copy-previous` |
| Recurring | `GET/POST /api/recurring` · `PATCH/DELETE /api/recurring/{id}` · `POST /api/recurring/run` (materialize due now) |
| Import | `POST /api/import/zenmoney` (file → dry-run preview + proposed mapping) · `POST /api/import/zenmoney/commit` (mapping → batch) · `GET /api/import/batches` · `DELETE /api/import/batches/{id}` (undo) |

Recurring materialization is **lazy**: any authenticated request runs a cheap
"due rules?" check once per day per household (plus the explicit `run`
endpoint). No scheduler process/container.

## 6. Frontend: views & flows

App shell identical in structure to dtasks: fixed `100dvh`, sidebar
navigation, scrollable content pane, `.ph` page headers, light/dark theme
toggle, EN/RU language toggle (persisted, defaults to browser language).

- **Dashboard** — current month: income / expenses / net cards (EUR),
  budget status strip, spending-by-category chart, net-worth trend line,
  recent entries.
- **Transactions** — the ledger: month switcher, filters (account, category,
  search), edit in place; transfers rendered inline with a distinct transfer
  style. Quick-add is an omnibox — one text box parsed by sigil: `!` amount,
  `#` account, `@` category, a bare date token, `//` note, leftover words =
  merchant (sigils deliberately invert the sibling dtasks project's
  convention, where `#` tags a project — an intentional owner choice, not a
  bug to fix), falling back to a `⚙ detailed` pane with today's structured
  fields, pre-filled from the parse. A purchase can be entered at the till
  under one category, then split later into N category lines that must sum
  to the original amount (or split inline from the omnibox in one line); the
  ledger renders a split as a collapsible group — one header row, category
  lines nested beneath. v1 is split-once: a saved split cannot be re-edited,
  only deleted and re-entered.
- **Accounts** — cards per account: native balance + EUR equivalent, type
  icon, quick "Transfer" action; add/edit/archive; opening balance.
- **Budgets** — month grid: per category limit vs spent (progress bar,
  over/under coloring), copy-from-previous-month action.
- **Recurring** — rules list with next-run dates, pause/resume, "run now".
- **Settings** — Members & invites (generate/revoke join codes) · Categories
  editor (two-level, drag order, archive) · Currencies & rates (table for a
  chosen date, manual override, refresh) · Import (ZenMoney wizard) ·
  Appearance (theme, language).
- **Welcome** — ported dtasks signup/login card + optional OAuth buttons +
  "I have a join code" variant.

Money display: `Intl.NumberFormat` with the app locale, `tabular-nums`
everywhere amounts align in columns; expenses plain/red-tinted, income
green with `+`, transfers neutral blue (tokens in the design system doc).

## 7. ZenMoney import (one-time)

- Input: ZenMoney CSV export (semicolon-separated dump with paired
  income/outcome columns per row; transfers appear as rows with both sides
  filled). Exact column set verified against a real export file at
  implementation time — get a fresh export from the owner first.
- Wizard: upload → dry-run preview (row count, date range, detected
  accounts/currencies, detected category names, unparsable rows) → mapping
  step (ZenMoney account → DCash account (create-on-import offered),
  ZenMoney category → group/subcategory) → commit as one `import_batch`.
- Transfer pairs become `transfers` rows (both amounts preserved — implied
  historical rate needs no rates data); plain rows become transactions.
- Historical FX rates for the imported date range are backfilled (§4) so
  reports over history are correct immediately.
- Idempotent: re-uploading the same file into a new batch after deleting the
  old one is the undo/redo story. Batch delete removes exactly its rows.

## 8. Design system

Extracted from dtasks into [`docs/design-system.md`](design-system.md):
tokens (light/dark), fonts (Plus Jakarta Sans / Lora), component classes
(`.btn`, `.card`, `.input`, `.nav`, `.badge`, `.ph`…), plus DCash-specific
finance tokens (income/expense/transfer) and money-typography rules.
`frontend/src/index.css` in this repo is the executable form of that doc,
same as in dtasks.

## 9. Auth (delta over dtasks)

Everything in dtasks `docs/auth.md` applies (argon2, dummy-hash timing
defense, session FileStore, rate limits, secure cookies, OAuth optional per
provider via env). DCash adds:

- Signup path A (global invite code) → creates `household` + `owner` member.
- Signup path B (join code) → validates unexpired unused
  `household_invites` row, creates user as `member`, marks code used.
- Existing-user join: not in v1 (a user stays in the household they signed
  up into; changing requires operator SQL).
- Seed data: new household gets the default category tree (§3), no demo
  transactions.

## 10. Deployment

### Target topology (decision: shared Caddy)

```
Oracle VM (existing, ARM64, Ubuntu 24.04, Docker)
├── ~/dinfra  — git clone of evgenii-prusov/dinfra   [LIVE since 2026-07-19]
│   └── caddy: owns ports 80/443, docker network "web" (external),
│       site blocks: dtasks.dev → dtasks-app:8000    [live]
│                    dengi.dev  → dcash-app:8000     [commented out until first dcash deploy]
├── ~/dtasks  — existing compose project, caddy service removed (PR #71),
│   app on network "web" with alias "dtasks-app"     [live]
└── ~/dcash   — new compose project (app only),
    app joins network "web" with alias "dcash-app"   [to be created, E9]
```

Both app services are named `app` inside their own compose files — the
**distinct network aliases** on `web` are what keeps Caddy's upstreams
unambiguous. Each app keeps its own default compose network too.

### Migration — executed 2026-07-19

Done ahead of all dcash work, to prove dtasks survives the topology change:
`dinfra` repo created and cloned to `~/dinfra`; `web` network created; the
running dtasks app was pre-connected with alias `dtasks-app`; the new caddy
volume was **pre-seeded from `dtasks_caddy-data`** so no cert re-issuance
happened; cutover (stop old caddy → start dinfra caddy) took seconds;
dtasks PR #71 then merged (app-only compose, `web` alias, docs updated) and
the VM reconciled with `git pull && docker compose up -d --remove-orphans`.
Verified https://dtasks.dev before and after; CD run on the merge green.
Old `dtasks_caddy-*` volumes are kept for now as a rollback path — delete
them once dcash is live and stable.

Still pending for dcash:

1. DNS: point `dengi.dev` A record at the VM's reserved IP (user action,
   bead in §12; IP via `terraform output public_ip` in dtasks/infra or the
   OCI console).
2. At first dcash deploy (E9): uncomment the `{$DCASH_DOMAIN}` block in
   dinfra's Caddyfile, add `DCASH_DOMAIN=dengi.dev` to `~/dinfra/.env`,
   then `git pull && docker compose up -d` in `~/dinfra`.

### DCash deploy (mirrors dtasks)

- `Dockerfile` (multi-stage: npm build → uv-based Python image, ARM64),
  `docker-entrypoint.sh` runs `alembic upgrade head` before uvicorn.
- `docker-compose.yml`: single `app` service, volume `dcash-data:/data`,
  env `DCASH_DB_PATH=/data/dcash.sqlite`, `DCASH_SESSION_DIR=/data/sessions`,
  `DCASH_SECURE_COOKIES=1`, `DCASH_PUBLIC_URL=https://dengi.dev`; `.env`
  carries `DCASH_INVITE_CODE`, optional OAuth creds.
- CD workflow copied from dtasks `cd.yml`: buildx linux/arm64 →
  `ghcr.io/evgenii-prusov/dcash` → SSH → `docker compose pull && up -d`.
  Repo secrets `SERVER_HOST` + `SSH_PRIVATE_KEY` copied from the dtasks repo
  (same VM, same key).
- OAuth (optional, can be enabled later): register dev/prod apps per dtasks
  `docs/deploy.md` recipe with dengi.dev callbacks.

### Backups

Port dtasks `scripts/backup_db.py` unchanged in approach: SQLite online
backup API, GFS retention (30 daily / weekly to ~2 months / monthly beyond),
daily cron on the VM into the `dcash-data` volume, periodic manual off-VM
copy. Restore = stop app, copy file in, start app.

## 11. Development workflow

- Beads (`bd`) for all task tracking, prefix `dcash`; JSONL auto-export on;
  DoltHub sync to be wired later (chore bead) — same architecture as dtasks.
- Feature branches + PRs; no direct commits to `main` (port dtasks
  `.beads-hooks` + GitHub branch protection during scaffolding).
- `Makefile` with the same targets as dtasks (`install`, `test`,
  `dev-backend`, `dev-frontend`, `start/stop/status/logs`).
- Pre-commit: ruff + oxlint + beads export, mirroring dtasks.

## 12. Milestones → beads epics

Build order: E1 → E2 → E3 → E9 (deploy early, then iterate live) → E4 → E5
→ E8 → E6 → E7.

| # | Epic | Depends on | Bead |
| - | ---- | ---------- | ---- |
| E1 | Scaffolding: repo, skeletons, design tokens, CI | — | `dcash-996` |
| E2 | Auth & households (port + tenancy + join codes) | E1 | `dcash-75y` |
| E3 | Core ledger: accounts, categories, transactions, transfers | E2 | `dcash-bpb` |
| E4 | FX rates: fetchers, storage, overrides, conversion | E3 | `dcash-z73` |
| E5 | Dashboard & reports | E3, E4 | `dcash-f20` |
| E6 | Budgets | E3, E4 | `dcash-8jr` |
| E7 | Recurring transactions | E3 | `dcash-w05` |
| E8 | ZenMoney import | E3, E4 | `dcash-qws` |
| E9 | Deploy dengi.dev: image, edge Caddy, CD, backups | E2, T1 | `dcash-gce` |
| T1 | DNS: point dengi.dev at the VM (user action) | — | `dcash-4oi` |
| C1 | Wire DoltHub sync for dcash beads | — | `dcash-05g` |

## 13. Out of scope for v1

Bank API connections (PSD2/open banking), ongoing generic CSV import,
receipts/attachments, PWA/mobile-first polish, investment & securities
tracking, per-user permissions inside a household beyond owner/member,
email sending (password reset stays an operator script, as in dtasks),
notifications, multi-household membership per user.
