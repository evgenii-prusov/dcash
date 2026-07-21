// Omnibox quick-add parser.
//
// A pure function, no React and no network: `parseOmnibox(input, ctx)` turns
// one line of sigil-delimited text into a structured entry the preview chip
// row and the submit handler both read. See
// docs/spec.md §6 and the plan section "New frontend/src/lib/omnibox.ts —
// the parser" for the full grammar this implements.
//
// Sigils: `!` amount · `#` account · `@` category · a bare date-shaped token
// · `//` note (swallows the rest of the line) · leftover bare words = merchant.
//
// NOTE: this deliberately inverts the dtasks convention — here `#` is the
// account and `@` is the category. Do not "fix" this to match dtasks.

import type { Account, CategoryGroup } from '../api/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A category resolved against `ctx.groups`, carrying enough of its parent
 * group along for display (muted group name) and for deriving the
 * transaction `kind` downstream. */
export interface ResolvedCategory {
  id: number
  name: string
  groupId: number
  groupName: string
  kind: 'expense' | 'income'
}

export interface ParsedAccount {
  /** Raw text typed after `#`, or null if the sigil was never used. */
  query: string | null
  /** The matched account, or null if `query` didn't resolve (or is absent
   * and no default account could be found). */
  resolved: Account | null
}

export interface ParsedLine {
  /** The resolved category for this line, or null if unresolved/absent. */
  category: ResolvedCategory | null
  /** Raw text typed after this line's `@`, or null if this is the implicit
   * placeholder line produced when the input has no `@` at all. */
  categoryQuery: string | null
  amountMinor: number | null
}

export interface ParsedEntry {
  /** The overall transaction total: the explicit leading `!amount` if one was
   * given, otherwise the sum of the lines' amounts (when every line has one),
   * otherwise null. */
  amountMinor: number | null
  account: ParsedAccount
  /** Always at least one entry. A plain (non-split) line is `lines.length === 1`;
   * an inline split is `lines.length >= 2`. */
  lines: ParsedLine[]
  /** YYYY-MM-DD */
  date: string
  payee: string | null
  note: string | null
  /** Blocking problems for the preview to render; non-empty means Add should
   * stay disabled. Entries are stable string codes (namespaced `problems.*`
   * to line up with the i18n catalog), not formatted messages. */
  problems: string[]
}

export interface OmniboxContext {
  accounts: Account[]
  groups: CategoryGroup[]
  /** YYYY-MM-DD. Passed in explicitly (never read from the system clock)
   * so the parser stays pure and deterministic under test. */
  today: string
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

const AMOUNT_SHAPE = /^\d+([.,]\d{1,2})?$/

/** `parseFloat("12,40")` is `12`, not `12.4` — RU users type commas by
 * default, so normalizing `,` → `.` before parsing is a real-money
 * correctness requirement, not a nicety. Returns minor units, or null if the
 * token isn't a valid amount shape. */
function parseAmountToken(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, '.')
  if (!AMOUNT_SHAPE.test(normalized)) return null
  return Math.round(parseFloat(normalized) * 100)
}

// ---------------------------------------------------------------------------
// Date parsing — EN + RU, regardless of the active UI locale
// ---------------------------------------------------------------------------

// Ordered so more specific prefixes are tried before shorter ones that would
// otherwise shadow them (март vs. май/мая both start with "ма").
const RU_MONTH_PREFIXES: [string, number][] = [
  ['мар', 3],
  ['ма', 5],
  ['янв', 1],
  ['фев', 2],
  ['апр', 4],
  ['июн', 6],
  ['июл', 7],
  ['авг', 8],
  ['сен', 9],
  ['окт', 10],
  ['ноя', 11],
  ['дек', 12],
]

const EN_MONTH_PREFIXES: [string, number][] = [
  ['jan', 1],
  ['feb', 2],
  ['mar', 3],
  ['apr', 4],
  ['may', 5],
  ['jun', 6],
  ['jul', 7],
  ['aug', 8],
  ['sep', 9],
  ['oct', 10],
  ['nov', 11],
  ['dec', 12],
]

function matchMonthWord(word: string): number | null {
  const w = word.toLowerCase()
  for (const [prefix, month] of EN_MONTH_PREFIXES) if (w.startsWith(prefix)) return month
  for (const [prefix, month] of RU_MONTH_PREFIXES) if (w.startsWith(prefix)) return month
  return null
}

function isTodayWord(w: string): boolean {
  const s = w.toLowerCase()
  return s === 'today' || s === 'сегодня'
}

function isYesterdayWord(w: string): boolean {
  const s = w.toLowerCase()
  return s === 'yesterday' || s === 'вчера'
}

const SIGIL_CHARS = new Set(['!', '#', '@'])

function isSigilToken(tok: string): boolean {
  return SIGIL_CHARS.has(tok[0])
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildDate(day: number, month: number, year: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function shiftDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return buildDate(dt.getUTCDate(), dt.getUTCMonth() + 1, dt.getUTCFullYear())
}

const DOT_DATE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/
const PLAIN_DAY = /^\d{1,2}$/

function resolveYear(y: string | undefined, fallbackYear: number): number {
  if (y === undefined) return fallbackYear
  return y.length <= 2 ? 2000 + Number(y) : Number(y)
}

/** Finds the first date-shaped run in `tokens` (a bare numeric date, a bare
 * "day monthword" pair, or a today/yesterday keyword — in EN or RU) and lifts
 * it out, once. Sigil-owned tokens (`!60`, `#cash`, `@groceries`, …) are never
 * considered: `!` owning the amount is what makes a bare `21.07` unambiguous
 * as a date, so this scan explicitly skips anything sigil-prefixed. */
function extractDate(tokens: string[], today: string): { date: string; rest: string[] } {
  const fallbackYear = Number(today.slice(0, 4))

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (isSigilToken(tok)) continue

    if (isTodayWord(tok)) {
      return { date: today, rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)] }
    }
    if (isYesterdayWord(tok)) {
      return { date: shiftDay(today, -1), rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)] }
    }

    const dot = DOT_DATE.exec(tok)
    if (dot) {
      const [, d, m, y] = dot
      return {
        date: buildDate(Number(d), Number(m), resolveYear(y, fallbackYear)),
        rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)],
      }
    }

    const slash = SLASH_DATE.exec(tok)
    if (slash) {
      const [, d, m, y] = slash
      return {
        date: buildDate(Number(d), Number(m), resolveYear(y, fallbackYear)),
        rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)],
      }
    }

    if (PLAIN_DAY.test(tok) && i + 1 < tokens.length && !isSigilToken(tokens[i + 1])) {
      const month = matchMonthWord(tokens[i + 1])
      if (month !== null) {
        return {
          date: buildDate(Number(tok), month, fallbackYear),
          rest: [...tokens.slice(0, i), ...tokens.slice(i + 2)],
        }
      }
    }
  }

  return { date: today, rest: tokens }
}

// ---------------------------------------------------------------------------
// Sigil segmentation
// ---------------------------------------------------------------------------

type Sigil = '!' | '#' | '@'

interface Segment {
  sigil: Sigil | null
  words: string[]
}

/** Splits tokens into runs: an initial (possibly empty) merchant run with no
 * sigil, then one run per sigil-prefixed token, each swallowing bare words
 * until the next sigil — so multi-word names (`@Public transport`) work. */
function segmentTokens(tokens: string[]): Segment[] {
  const segments: Segment[] = [{ sigil: null, words: [] }]
  for (const tok of tokens) {
    const c = tok[0]
    if (c === '!' || c === '#' || c === '@') {
      const rest = tok.slice(1)
      segments.push({ sigil: c, words: rest ? [rest] : [] })
    } else {
      segments[segments.length - 1].words.push(tok)
    }
  }
  return segments
}

// ---------------------------------------------------------------------------
// Account / category resolution — exact, case-insensitive. Never fuzzy: a
// typo'd `#cahs` must not silently fall back to a default account, or the
// entry books to the wrong account and corrupts balances.
// ---------------------------------------------------------------------------

function resolveAccount(query: string, accounts: Account[]): Account | null {
  const q = query.trim().toLowerCase()
  return accounts.find((a) => a.name.trim().toLowerCase() === q) ?? null
}

function resolveCategory(query: string, groups: CategoryGroup[]): ResolvedCategory | null {
  const q = query.trim().toLowerCase()
  for (const g of groups) {
    for (const c of g.categories) {
      if (c.name.trim().toLowerCase() === q) {
        return { id: c.id, name: c.name, groupId: g.id, groupName: g.name, kind: g.kind }
      }
    }
  }
  return null
}

function defaultAccount(accounts: Account[]): Account | null {
  // The caller (OmniboxAdd.tsx) is responsible for ordering/filtering
  // `ctx.accounts` so the last-used account (tracked in localStorage) sorts
  // first; this keeps the parser itself free of any localStorage read. If
  // that ordering isn't applied, this falls back to the first non-archived
  // account, matching the plan's documented default.
  return accounts.find((a) => !a.archived) ?? null
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseOmnibox(input: string, ctx: OmniboxContext): ParsedEntry {
  const problems: string[] = []
  const addProblem = (code: string) => {
    if (!problems.includes(code)) problems.push(code)
  }

  // 1. Split off the note first — it swallows everything after the first `//`.
  const noteSplit = input.indexOf('//')
  const headRaw = noteSplit === -1 ? input : input.slice(0, noteSplit)
  const noteRaw = noteSplit === -1 ? null : input.slice(noteSplit + 2).trim()
  const note = noteRaw && noteRaw.length > 0 ? noteRaw : null

  // 2. Lift the date out of the head, wherever it sits, once.
  const rawTokens = headRaw.split(/\s+/).filter(Boolean)
  const { date, rest: tokens } = extractDate(rawTokens, ctx.today)

  // 3. Segment the remainder into merchant + sigil runs.
  const segments = segmentTokens(tokens)
  const merchantWords = segments[0].words
  const payee = merchantWords.length > 0 ? merchantWords.join(' ') : null

  let accountQuery: string | null = null
  let pendingTotal: number | null = null
  const lines: ParsedLine[] = []
  let currentLine: ParsedLine | null = null

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]

    if (seg.sigil === '#') {
      const q = seg.words.join(' ')
      if (q) accountQuery = q
      continue
    }

    if (seg.sigil === '@') {
      // A category with no amount between it and the next `@` is left
      // dangling — pushed as-is; its missing amount is reported below.
      if (currentLine) lines.push(currentLine)
      const categoryQuery = seg.words.join(' ') || null
      currentLine = {
        category: categoryQuery ? resolveCategory(categoryQuery, ctx.groups) : null,
        categoryQuery,
        amountMinor: null,
      }
      continue
    }

    if (seg.sigil === '!') {
      const raw = seg.words.join(' ')
      const amount = raw ? parseAmountToken(raw) : null
      if (raw && amount === null) addProblem('problems.amountInvalid')

      if (currentLine) {
        // This amount is claimed by the category that opened before it.
        currentLine.amountMinor = amount
        lines.push(currentLine)
        currentLine = null
      } else {
        // An amount before any `@` is the total.
        pendingTotal = amount
      }
      continue
    }
  }
  if (currentLine) lines.push(currentLine)

  // 4. A missing `@category` altogether still gets a line — so routing
  // ("1 line -> single create, >=2 -> split") never needs a special case —
  // but it's flagged as a problem: unlike account, category has no default,
  // since `kind` is derived from it and silently filing to "Other" would
  // quietly corrupt the reports.
  const sawCategory = lines.length > 0
  if (!sawCategory) {
    lines.push({ category: null, categoryQuery: null, amountMinor: null })
  }

  // 5. Reconcile the leading total (if any) against the line amounts.
  if (pendingTotal !== null) {
    if (lines.length === 1) {
      if (lines[0].amountMinor === null) {
        lines[0].amountMinor = pendingTotal
      } else if (lines[0].amountMinor !== pendingTotal) {
        addProblem('problems.totalMismatch')
      }
    } else {
      const sum = lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0)
      if (sum !== pendingTotal) addProblem('problems.totalMismatch')
    }
  }

  if (!sawCategory) addProblem('problems.categoryMissing')
  for (const line of lines) {
    if (line.categoryQuery !== null && line.category === null) addProblem('problems.categoryNotFound')
    if (line.amountMinor === null) addProblem('problems.amountMissing')
  }

  // 6. Resolve the account — absent falls back to a default; present but
  // unmatched (a typo) blocks instead of silently booking to the default.
  let account: ParsedAccount
  if (accountQuery !== null) {
    const resolved = resolveAccount(accountQuery, ctx.accounts)
    account = { query: accountQuery, resolved }
    if (!resolved) addProblem('problems.accountNotFound')
  } else {
    account = { query: null, resolved: defaultAccount(ctx.accounts) }
  }

  // 7. Overall total: the explicit total if one was typed, otherwise the sum
  // of the lines when every one of them resolved an amount.
  const allLinesHaveAmount = lines.every((l) => l.amountMinor !== null)
  const linesSum = allLinesHaveAmount ? lines.reduce((s, l) => s + (l.amountMinor as number), 0) : null
  const amountMinor = pendingTotal !== null ? pendingTotal : linesSum

  return { amountMinor, account, lines, date, payee, note, problems }
}
