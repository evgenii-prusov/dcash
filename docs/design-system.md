# DCash design system — extracted from dtasks

Source of truth in dtasks: `frontend/src/index.css` (tokens + component
classes, themselves ported from the `project/FlowTask.html` prototype).
This doc is the DCash port: everything carried over verbatim, plus the
finance-specific additions in §4. The executable form lives in this repo's
`frontend/src/index.css` (Tailwind 4, CSS-first `@theme inline` mapping).

**Character:** warm paper. Cream background, near-black warm ink, one muted
sage-green accent, serif display type over a compact sans UI. Quiet borders
and hairline dividers instead of heavy chrome; small radii (6/10px); one
soft shadow; 0.12s transitions. Dense but calm — 13–14px UI type.

## 1. Tokens

CSS custom properties on `:root`, overridden under `[data-theme='dark']`;
mapped to Tailwind utilities via `@theme inline` (`--color-bg`,
`--color-surface`, `--color-ink`, … as in dtasks).

| Token | Light | Dark | Role |
| ----- | ----- | ---- | ---- |
| `--bg` | `#faf8f5` | `#18150f` | App background |
| `--surface` | `#ffffff` | `#211d15` | Cards, inputs |
| `--surface-2` | `#f3f0eb` | `#2a251c` | Hovers, wells, subtle chips |
| `--border` | `#e5e0d8` | `#38322a` | All borders & dividers |
| `--text` | `#1c1917` | `#ede8e0` | Primary ink |
| `--text-2` | `#6b6560` | `#9a9188` | Secondary ink |
| `--text-3` | `#a49e98` | `#5a5248` | Tertiary / placeholders |
| `--accent` | `#5a7a5f` | `#7aaf80` | Sage green — primary actions, active nav |
| `--accent-2` | `#ebf2ec` | `#1c2e1f` | Accent tint background |
| `--green` | `#3e8e4f` | `#5fc474` | Positive |
| `--green-2` | `#e3f3e6` | `#15301c` | Positive tint |
| `--high-bg` / `--high-text` | `#fef3e2` / `#9a5a10` | `#2a1c08` / `#d4883a` | "Attention" badge pair |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,.07)` | `0 1px 4px rgba(0,0,0,.3)` | Card shadow |

Carried over but repurposed rather than dropped: dtasks' `--must`/`--must-2`
(burnt orange `#c05a22`/`#fdf0e8`, dark `#e07840`/`#2a1508`) become the
**warning/over-budget** pair in DCash. The habit-grid tokens are not ported.

## 2. Typography

- **UI sans:** `'Plus Jakarta Sans', 'Inter', sans-serif` (@fontsource,
  self-hosted). Body 14px / line-height 1.5, antialiased; most controls
  13–13.5px; section labels 10px uppercase bold with 0.09em tracking
  (`.s-lbl`); badges 10–11px.
- **Display serif:** `'Lora', serif` — page titles (`.ph-title`, 22px/600,
  −0.4px tracking) and, new in DCash, the large money figures on dashboard
  cards (see §4).

## 3. Component classes (ported)

Same class names and metrics as dtasks so markup patterns transfer directly:

- `.nav` / `.nav.on` / `.nav-badge` — sidebar items: 13px/500, 6px radius,
  active = accent tint bg + accent text + 600 weight.
- `.ph` / `.ph-title` / `.ph-sub` — page header block, 28px bottom margin.
- `.btn` (+ `.btn-p` accent-filled, `.btn-g` ghost/bordered, `.btn-s` small,
  `.btn-danger` red hover ghost) — 7×13px padding, 6px radius, 13px/500;
  disabled = 0.35 opacity.
- `.card` / `.card-head` — surface, 1px border, **10px radius**, shadow-sm,
  14px stack gap; header row 12×16px padding with bottom border.
- `.input` / `.textarea` / `.sel` — surface bg, 1px border, 6px radius,
  13px; focus = accent border, no ring.
- `.badge` family — 10px/600, 4px radius chips (`.b-low` neutral, `.b-high`
  attention pair, `.b-green` positive, `.b-proj` muted). DCash adds
  `.b-exp` / `.b-inc` / `.b-tfr` from §4 tokens.
- Row pattern (dtasks `.task-row` → DCash `.txn-row`): 9×14px padding,
  hairline bottom borders, last-child borderless, `--surface-2` hover.
- `.empty` / `.empty-icon` — centered empty states, 56px vertical padding.
- Scrollbars: 5px, `--border` thumb.

App shell: `body { height: 100dvh; overflow: hidden }`, sidebar + scrollable
content pane; theme via `data-theme` attribute persisted in localStorage;
EN/RU via i18next, persisted, defaults to browser language.

## 4. DCash additions (finance semantics)

New token pairs, tuned to sit in the same warm palette. **Proposed values —
verify text-on-tint contrast ≥ 4.5:1 in both themes during implementation
(load the `dataviz` skill; it ships a validator):**

| Token | Light | Dark | Role |
| ----- | ----- | ---- | ---- |
| `--income` / `--income-2` | reuse `--green` / `--green-2` | reuse | Income amounts, `+` badges |
| `--expense` | `#b0432f` | `#d96b52` | Expense accents (not every expense number — see below) |
| `--expense-2` | `#fbeae6` | `#2a120c` | Expense tint |
| `--transfer` | `#4a6b8a` | `#7a9fc0` | Transfer accents |
| `--transfer-2` | `#e8eff5` | `#16222e` | Transfer tint |
| `--warn` / `--warn-2` | = `--must` / `--must-2` | = | Over-budget, attention |

Money typography rules:

- `font-variant-numeric: tabular-nums` on every aligned amount column,
  balance figure and chart axis.
- Ledger amounts: expenses in plain ink (they are the majority — a wall of
  red is noise), income in `--income` with a leading `+`, transfers in
  `--transfer` with `⇄`/arrow. Negative **balances** (credit cards) in
  `--expense`.
- Big dashboard figures: Lora serif, sign and currency symbol slightly
  muted (`--text-2`), minor units at reduced size.
- Native-currency amount is primary; EUR equivalent secondary in
  `--text-3` 11px beside/beneath it.
- Currency chips use the `.badge` pattern (`EUR` `USD` `RUB`).

Charts (recharts): series colors derive from tokens — categorical palettes
start from `--accent`, `--transfer`, `--warn`, `--expense` tints; income vs
expense comparisons always green-vs-red from the pairs above; grid lines
`--border`; labels `--text-2`/`--text-3`. Follow the `dataviz` skill before
writing any chart code.

## 5. Iconography & tone

Dtasks uses a tiny inline SVG `Icon` component (stroke style) plus sparse
emoji in empty states — port the same approach with finance glyphs
(wallet, arrows, chart, piggy bank). No icon font, no external icon set.
Microcopy tone: short, lowercase-friendly, bilingual EN/RU from day one.
