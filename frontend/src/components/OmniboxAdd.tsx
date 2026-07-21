import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseOmnibox, type ParsedEntry, type ResolvedCategory } from '../lib/omnibox'
import {
  useCreateCategory,
  useCreateSplitTransaction,
  useCreateTransaction,
  usePayees,
} from '../api/hooks'
import type { Account, CategoryGroup, PayeeSuggestion } from '../api/types'
import { Ic } from './Icon'

const LAST_ACCOUNT_KEY = 'dcash_last_account_id'
const MAX_MERCHANT_SUGGESTIONS = 8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function formatMoney(minor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

function formatDateLabel(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Same normalize-comma-before-parseFloat requirement as the omnibox parser
 * (RU users type commas), applied to the detailed pane's amount field. */
function parseDetailedAmount(raw: string): number {
  return Math.round(parseFloat(raw.trim().replace(/,/g, '.')) * 100)
}

function findCategoryName(groups: CategoryGroup[], id: number): string | null {
  for (const g of groups) {
    const c = g.categories.find((cat) => cat.id === id)
    if (c) return c.name
  }
  return null
}

/** Orders accounts so the last-used one (tracked in localStorage) sorts
 * first — parseOmnibox's default-account fallback just picks the first
 * non-archived entry, so this ordering is what actually implements
 * "remember the last account" per the parser's documented contract. */
function orderAccountsForOmnibox(accounts: Account[], lastAccountId: number | null): Account[] {
  const nonArchived = accounts.filter((a) => !a.archived).sort((a, b) => a.sort_order - b.sort_order)
  if (lastAccountId == null) return nonArchived
  const idx = nonArchived.findIndex((a) => a.id === lastAccountId)
  if (idx <= 0) return nonArchived
  const copy = nonArchived.slice()
  const [acc] = copy.splice(idx, 1)
  copy.unshift(acc)
  return copy
}

/** Prefix matches ranked above substring ones, each group keeping the
 * endpoint's own usage/recency order — so `ed` surfaces `EDEKA` first. */
function rankMerchants(payees: PayeeSuggestion[], query: string): PayeeSuggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) return payees.slice(0, MAX_MERCHANT_SUGGESTIONS)
  const prefix: PayeeSuggestion[] = []
  const substring: PayeeSuggestion[] = []
  for (const p of payees) {
    const name = p.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(p)
    else if (name.includes(q)) substring.push(p)
  }
  return [...prefix, ...substring].slice(0, MAX_MERCHANT_SUGGESTIONS)
}

// ---------------------------------------------------------------------------
// Caret-run detection — the dropdown's contents depend on which run (bare
// leading words, `#…`, `@…`) the caret currently sits in, not just on the
// tail of the string (dtasks' QuickAddTask only ever looks at the end).
// ---------------------------------------------------------------------------

type RunKind = 'merchant' | 'account' | 'category' | 'none'

interface CaretRun {
  kind: RunKind
  /** Raw text typed in this run, from its start up to the caret. */
  query: string
  /** Offset in the full input where this run's content begins (right after
   * the sigil, or 0 for the leading merchant run). */
  start: number
}

function isSigilChar(c: string): boolean {
  return c === '!' || c === '#' || c === '@'
}

const DOT_DATE_RE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/
const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/
const PLAIN_DAY_RE = /^\d{1,2}$/
const EN_MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// Same ordering as lib/omnibox.ts's RU_MONTH_PREFIXES — longer/more specific
// prefixes first so "март" isn't shadowed by the shorter "ма" (май/мая).
const RU_MONTH_PREFIXES = ['мар', 'ма', 'янв', 'фев', 'апр', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function isMonthWord(word: string): boolean {
  const w = word.toLowerCase()
  return EN_MONTH_PREFIXES.some((p) => w.startsWith(p)) || RU_MONTH_PREFIXES.some((p) => w.startsWith(p))
}

function isTodayOrYesterdayWord(word: string): boolean {
  const w = word.toLowerCase()
  return w === 'today' || w === 'сегодня' || w === 'yesterday' || w === 'вчера'
}

/** Mirrors lib/omnibox.ts's extractDate closely enough to know which
 * token(s) the real parser lifts out as the date, so the tokenizer below can
 * exclude them the same way. Without this, a trailing bare date
 * (`@groceries 19.07`) gets swallowed into the category run's query and the
 * dropdown misreads it as an unresolved category name — offering a bogus
 * "Create '<name> 19.07' in ▸" instead of just leaving the (already-valid)
 * `@groceries` alone. Duplicated rather than imported: lib/omnibox.ts's
 * helpers aren't exported, and the file is off-limits to touch. */
function findDateTokenIndices(tokens: string[]): Set<number> {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (isSigilChar(tok[0])) continue
    if (isTodayOrYesterdayWord(tok)) return new Set([i])
    if (DOT_DATE_RE.test(tok)) return new Set([i])
    if (SLASH_DATE_RE.test(tok)) return new Set([i])
    if (PLAIN_DAY_RE.test(tok) && i + 1 < tokens.length && !isSigilChar(tokens[i + 1][0]) && isMonthWord(tokens[i + 1])) {
      return new Set([i, i + 1])
    }
  }
  return new Set()
}

function findCaretRun(text: string, caret: number): CaretRun {
  // `//` opens the note — nothing after it is a sigil run.
  const noteIdx = text.indexOf('//')
  if (noteIdx !== -1 && caret > noteIdx) return { kind: 'none', query: '', start: caret }

  const tokens: { start: number; end: number; text: string }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }

  const dateIndices = findDateTokenIndices(tokens.map((tk) => tk.text))

  let activeIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    if (caret >= tokens[i].start && caret <= tokens[i].end) activeIdx = i
  }
  if (activeIdx === -1) return { kind: 'none', query: '', start: caret }
  // The caret sits on the bare date token itself — never a sigil run.
  if (dateIndices.has(activeIdx)) return { kind: 'none', query: '', start: caret }

  // Walk backward for the nearest sigil-prefixed token governing this run,
  // skipping over the date token(s) exactly like the parser's own
  // segmentation would (they're lifted out before segmenting); none found
  // means we're still in the leading (merchant) run.
  let govIdx = -1
  for (let i = activeIdx; i >= 0; i--) {
    if (dateIndices.has(i)) continue
    const c = tokens[i].text[0]
    if (isSigilChar(c)) {
      govIdx = i
      break
    }
  }
  if (govIdx === -1) return { kind: 'merchant', query: text.slice(0, caret), start: 0 }

  const sigil = tokens[govIdx].text[0]
  const start = tokens[govIdx].start + 1
  const query = text.slice(start, caret)
  if (sigil === '#') return { kind: 'account', query, start }
  if (sigil === '@') return { kind: 'category', query, start }
  return { kind: 'none', query, start } // '!' owns the amount — no dropdown
}

// ---------------------------------------------------------------------------
// Dropdown entries
// ---------------------------------------------------------------------------

type DropdownEntry =
  | { kind: 'merchant'; payee: PayeeSuggestion }
  | { kind: 'account'; account: Account }
  | { kind: 'category'; category: ResolvedCategory }
  | { kind: 'category-create' }
  | { kind: 'category-create-in-group'; group: CategoryGroup }

// ---------------------------------------------------------------------------
// Preview problems
// ---------------------------------------------------------------------------

function problemMessage(code: string, parsed: ParsedEntry, t: ReturnType<typeof useTranslation>['t']): string {
  // Problem codes are a fixed set (see lib/omnibox.ts) but typed as `string[]`
  // on ParsedEntry, so the key here isn't a literal the i18next resource
  // typing can narrow — same escape hatch as SettingsView's `rates.${source}`.
  if (code === 'problems.categoryNotFound') {
    const bad = parsed.lines.find((l) => l.categoryQuery && !l.category)
    return t(`ledger.${code}` as never, { query: bad?.categoryQuery ?? '' })
  }
  if (code === 'problems.accountNotFound') {
    return t(`ledger.${code}` as never, { query: parsed.account.query ?? '' })
  }
  return t(`ledger.${code}` as never)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OmniboxAdd({
  groups,
  accounts,
  onAdded,
}: {
  groups: CategoryGroup[]
  accounts: Account[]
  onAdded: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-GB'

  const createTx = useCreateTransaction()
  const createSplit = useCreateSplitTransaction()
  const createCategory = useCreateCategory()
  const { data: payees } = usePayees()

  const [today] = useState(todayISO)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [creatingCategoryName, setCreatingCategoryName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [detailed, setDetailed] = useState(false)
  const [lastAccountId, setLastAccountId] = useState<number | null>(() => {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY)
    return raw ? Number(raw) : null
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Detailed-pane fields, pre-filled from the parse only on the transition
  // into detailed mode (see the effect below) — a continuation, not a reset.
  const [dAccountId, setDAccountId] = useState<number>(0)
  const [dCategoryId, setDCategoryId] = useState<number>(0)
  const [dAmount, setDAmount] = useState('')
  const [dDate, setDDate] = useState(today)
  const [dPayee, setDPayee] = useState('')

  const orderedAccounts = useMemo(
    () => orderAccountsForOmnibox(accounts, lastAccountId),
    [accounts, lastAccountId],
  )
  const allCats = useMemo(() => groups.flatMap((g) => g.categories), [groups])

  const parsed = useMemo(
    () => parseOmnibox(text, { accounts: orderedAccounts, groups, today }),
    [text, orderedAccounts, groups, today],
  )

  const caretRun = useMemo(() => findCaretRun(text, caret), [text, caret])

  const payeeList = payees ?? []

  const catMatches = useMemo((): ResolvedCategory[] => {
    if (caretRun.kind !== 'category') return []
    const q = caretRun.query.trim().toLowerCase()
    const out: ResolvedCategory[] = []
    for (const g of groups) {
      for (const c of g.categories) {
        if (c.archived) continue
        if (!q || c.name.toLowerCase().includes(q)) {
          out.push({ id: c.id, name: c.name, groupId: g.id, groupName: g.name, kind: g.kind })
        }
      }
    }
    return out
  }, [caretRun, groups])

  const rankedMerchants = useMemo(
    () => (caretRun.kind === 'merchant' ? rankMerchants(payeeList, caretRun.query) : []),
    [caretRun, payeeList],
  )

  const exactMerchantMatch =
    caretRun.kind === 'merchant' &&
    caretRun.query.trim().length > 0 &&
    payeeList.some((p) => p.name.toLowerCase() === caretRun.query.trim().toLowerCase())

  const dropdownEntries: DropdownEntry[] = useMemo(() => {
    if (caretRun.kind === 'merchant') {
      if (exactMerchantMatch) return []
      return rankedMerchants.map((payee) => ({ kind: 'merchant' as const, payee }))
    }
    if (caretRun.kind === 'account') {
      const q = caretRun.query.trim().toLowerCase()
      return orderedAccounts
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .map((account) => ({ kind: 'account' as const, account }))
    }
    if (caretRun.kind === 'category') {
      if (creatingCategoryName !== null) {
        return groups.map((group) => ({ kind: 'category-create-in-group' as const, group }))
      }
      const entries: DropdownEntry[] = catMatches.map((category) => ({ kind: 'category' as const, category }))
      if (caretRun.query.trim().length > 0 && catMatches.length === 0) {
        entries.push({ kind: 'category-create' })
      }
      return entries
    }
    return []
  }, [caretRun, exactMerchantMatch, rankedMerchants, orderedAccounts, groups, creatingCategoryName, catMatches])

  const dropdownVisible = open && caretRun.kind !== 'none' && dropdownEntries.length > 0

  useEffect(() => {
    setSelectedIndex(0)
  }, [caretRun.kind, caretRun.query, creatingCategoryName])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreatingCategoryName(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (pendingCaret === null) return
    const el = inputRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(pendingCaret, pendingCaret)
    }
    setCaret(pendingCaret)
    setPendingCaret(null)
  }, [pendingCaret])

  // Re-seed the detailed pane only on the false -> true transition, so it
  // continues whatever the omnibox had parsed rather than restarting.
  useEffect(() => {
    if (!detailed) return
    setDAccountId(parsed.account.resolved?.id ?? orderedAccounts[0]?.id ?? 0)
    setDCategoryId(parsed.lines[0]?.category?.id ?? allCats[0]?.id ?? 0)
    setDAmount(parsed.amountMinor != null ? (parsed.amountMinor / 100).toFixed(2) : '')
    setDDate(parsed.date)
    setDPayee(parsed.payee ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailed])

  function applyReplacement(run: CaretRun, insertText: string) {
    setText((prev) => {
      const before = prev.slice(0, run.start)
      const after = prev.slice(caret)
      const insertion = `${insertText} `
      setPendingCaret(before.length + insertion.length)
      return before + insertion + after
    })
    setOpen(false)
    setSelectedIndex(0)
  }

  function selectMerchant(payee: PayeeSuggestion) {
    setText((prev) => {
      const before = prev.slice(0, caretRun.start)
      const after = prev.slice(caret)
      const withMerchant = `${before}${payee.name} ${after}`
      const caretAfterMerchant = `${before}${payee.name} `.length
      let next = withMerchant
      // Merchant -> category pre-fill: only when no `@` has been typed yet,
      // and it must land visibly in the text (and so the preview) rather
      // than being applied silently.
      if (payee.top_category_id != null && !prev.includes('@')) {
        const name = findCategoryName(groups, payee.top_category_id)
        if (name) next = `${next.trimEnd()} @${name}`
      }
      setPendingCaret(caretAfterMerchant)
      return next
    })
    setOpen(false)
    setSelectedIndex(0)
  }

  function selectEntry(entry: DropdownEntry) {
    if (entry.kind === 'merchant') return selectMerchant(entry.payee)
    if (entry.kind === 'account') return applyReplacement(caretRun, entry.account.name)
    if (entry.kind === 'category') return applyReplacement(caretRun, entry.category.name)
    if (entry.kind === 'category-create') {
      setCreatingCategoryName(caretRun.query.trim())
      setSelectedIndex(0)
      return
    }
    // category-create-in-group: actually create the category now.
    const name = creatingCategoryName ?? caretRun.query.trim()
    const group = entry.group
    setError('')
    createCategory.mutate(
      { group_id: group.id, name },
      {
        onSuccess: (created) => {
          applyReplacement(caretRun, created.name)
          setCreatingCategoryName(null)
        },
        onError: (err: unknown) => setError(err instanceof Error ? err.message : t('common.genericError')),
      },
    )
  }

  function syncCaret(el: HTMLInputElement) {
    setCaret(el.selectionStart ?? el.value.length)
  }

  const isPending = createTx.isPending || createSplit.isPending
  const submitDisabled = parsed.problems.length > 0 || !parsed.account.resolved || isPending

  async function handleSubmit() {
    if (submitDisabled || !parsed.account.resolved) return
    setError('')
    const accountId = parsed.account.resolved.id
    try {
      if (parsed.lines.length === 1) {
        await createTx.mutateAsync({
          account_id: accountId,
          category_id: parsed.lines[0].category!.id,
          amount_minor: parsed.amountMinor!,
          date: parsed.date,
          payee: parsed.payee,
          note: parsed.note,
        })
      } else {
        await createSplit.mutateAsync({
          account_id: accountId,
          date: parsed.date,
          payee: parsed.payee,
          note: parsed.note,
          lines: parsed.lines.map((l) => ({ category_id: l.category!.id, amount_minor: l.amountMinor! })),
        })
      }
      localStorage.setItem(LAST_ACCOUNT_KEY, String(accountId))
      setLastAccountId(accountId)
      setText('')
      setCaret(0)
      onAdded()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.genericError'))
    }
  }

  async function handleDetailedSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amountMinor = parseDetailedAmount(dAmount)
    if (!dAmount || isNaN(amountMinor) || amountMinor <= 0) return setError(t('ledger.invalidAmount'))
    if (!dAccountId || !dCategoryId) return setError(t('ledger.selectAccountCategory'))
    try {
      await createTx.mutateAsync({
        account_id: dAccountId,
        category_id: dCategoryId,
        amount_minor: amountMinor,
        date: dDate,
        payee: dPayee || null,
      })
      localStorage.setItem(LAST_ACCOUNT_KEY, String(dAccountId))
      setLastAccountId(dAccountId)
      setText('')
      setDetailed(false)
      onAdded()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.genericError'))
    }
  }

  // ---------------------------------------------------------------------------
  // Preview chips
  // ---------------------------------------------------------------------------

  const currency = parsed.account.resolved?.currency ?? 'EUR'
  const chips: { text: string; warn: boolean }[] = []
  if (parsed.amountMinor != null) {
    chips.push({
      text: formatMoney(parsed.amountMinor, currency, locale),
      warn: parsed.problems.includes('problems.totalMismatch') || parsed.problems.includes('problems.amountInvalid'),
    })
  } else {
    chips.push({ text: t('ledger.amount'), warn: true })
  }
  if (parsed.lines.length === 1) {
    const line = parsed.lines[0]
    if (line.category) chips.push({ text: line.category.name, warn: false })
    else chips.push({ text: line.categoryQuery ?? t('ledger.problems.categoryMissing'), warn: true })
  } else {
    const parts = parsed.lines.map((l) => {
      const name = l.category?.name ?? l.categoryQuery ?? '?'
      const amt = l.amountMinor != null ? formatMoney(l.amountMinor, currency, locale) : '?'
      return `${name} ${amt}`
    })
    chips.push({ text: parts.join(' + '), warn: parsed.lines.some((l) => !l.category || l.amountMinor == null) })
  }
  if (parsed.account.resolved) {
    chips.push({ text: parsed.account.resolved.name, warn: false })
  } else {
    chips.push({ text: parsed.account.query ?? t('ledger.noAccountsYet'), warn: true })
  }
  chips.push({ text: formatDateLabel(parsed.date, locale), warn: false })
  if (parsed.payee) chips.push({ text: parsed.payee, warn: false })

  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
      {error && <p className="text-[12px] text-warn">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-3">{!detailed && t('ledger.omniboxHint')}</p>
        <button
          type="button"
          className={`btn btn-s ${detailed ? 'btn-p' : 'btn-g'}`}
          onClick={() => setDetailed((d) => !d)}
        >
          <Ic n="settings" s={11} />
          {t('ledger.detailed')}
        </button>
      </div>

      {!detailed ? (
        <>
          <div className="relative" ref={boxRef}>
            <input
              ref={inputRef}
              className="input w-full"
              value={text}
              placeholder={t('ledger.omniboxPlaceholder')}
              aria-autocomplete="list"
              aria-expanded={dropdownVisible}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setText(e.target.value)
                syncCaret(e.target)
                setOpen(true)
                setCreatingCategoryName(null)
              }}
              onSelect={(e) => syncCaret(e.currentTarget)}
              onKeyDown={(e) => {
                if (dropdownVisible) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSelectedIndex((prev) => (prev + 1) % dropdownEntries.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelectedIndex((prev) => (prev - 1 + dropdownEntries.length) % dropdownEntries.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    selectEntry(dropdownEntries[selectedIndex])
                    return
                  }
                }
                if (e.key === 'Escape') {
                  if (open) {
                    e.preventDefault()
                    setOpen(false)
                    setCreatingCategoryName(null)
                  }
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
            />

            {dropdownVisible && (
              <div className="absolute top-full left-0 z-50 mt-1 max-h-56 w-80 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-md">
                {caretRun.kind === 'merchant' && (
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                    {t('ledger.recentMerchants')}
                  </div>
                )}
                {dropdownEntries.map((entry, idx) => {
                  const isActive = idx === selectedIndex
                  const rowClass = `flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    isActive ? 'bg-accent-2 text-accent font-medium' : 'text-ink hover:bg-surface-2'
                  }`
                  if (entry.kind === 'merchant') {
                    return (
                      <button
                        key={`m-${entry.payee.name}`}
                        type="button"
                        className={rowClass}
                        onClick={() => selectEntry(entry)}
                      >
                        <span className="flex-1 truncate">{entry.payee.name}</span>
                      </button>
                    )
                  }
                  if (entry.kind === 'account') {
                    return (
                      <button
                        key={`a-${entry.account.id}`}
                        type="button"
                        className={rowClass}
                        onClick={() => selectEntry(entry)}
                      >
                        <span className="flex-1 truncate">{entry.account.name}</span>
                        <span className="shrink-0 text-[10px] uppercase text-ink-3">{entry.account.currency}</span>
                      </button>
                    )
                  }
                  if (entry.kind === 'category') {
                    return (
                      <button
                        key={`c-${entry.category.id}`}
                        type="button"
                        className={rowClass}
                        onClick={() => selectEntry(entry)}
                      >
                        <span className="flex-1 truncate">{entry.category.name}</span>
                        <span className="shrink-0 text-[10px] uppercase text-ink-3">{entry.category.groupName}</span>
                      </button>
                    )
                  }
                  if (entry.kind === 'category-create') {
                    return (
                      <button key="create" type="button" className={rowClass} onClick={() => selectEntry(entry)}>
                        <Ic n="plus" s={12} />
                        <span>{t('ledger.createCategoryIn', { name: caretRun.query.trim() })}</span>
                      </button>
                    )
                  }
                  return (
                    <button
                      key={`create-in-${entry.group.id}`}
                      type="button"
                      className={rowClass}
                      disabled={createCategory.isPending}
                      onClick={() => selectEntry(entry)}
                    >
                      <span className={`badge ${entry.group.kind === 'income' ? 'b-inc' : 'b-exp'}`}>
                        {entry.group.kind}
                      </span>
                      <span className="flex-1 truncate">{entry.group.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
            {chips.map((c, i) => (
              <span key={i} className={c.warn ? 'text-warn' : 'text-ink-2'}>
                {i > 0 && <span className="mr-1.5 text-ink-3">·</span>}
                {c.text}
              </span>
            ))}
          </div>

          {parsed.problems.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-warn">
              {parsed.problems.map((code) => (
                <li key={code}>{problemMessage(code, parsed, t)}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn btn-p btn-s" disabled={submitDisabled} onClick={() => void handleSubmit()}>
              <Ic n="plus" s={12} />
              {isPending ? t('common.saving') : t('ledger.addTransaction')}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleDetailedSubmit} className="flex flex-wrap gap-2">
          <select className="sel" value={dAccountId} onChange={(e) => setDAccountId(Number(e.target.value))}>
            {orderedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
          <select className="sel" value={dCategoryId} onChange={(e) => setDCategoryId(Number(e.target.value))}>
            {groups.map((g) =>
              g.categories.length > 0 ? (
                <optgroup key={g.id} label={g.name}>
                  {g.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <input
            className="input tnum w-28"
            type="text"
            inputMode="decimal"
            placeholder={t('ledger.amount')}
            value={dAmount}
            onChange={(e) => setDAmount(e.target.value)}
          />
          <input className="input w-32" type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} />
          <input
            className="input flex-1"
            placeholder={t('ledger.payee')}
            value={dPayee}
            onChange={(e) => setDPayee(e.target.value)}
          />
          <button type="submit" className="btn btn-p btn-s" disabled={createTx.isPending}>
            <Ic n="plus" s={12} />
            {createTx.isPending ? t('common.saving') : t('ledger.addTransaction')}
          </button>
        </form>
      )}
    </div>
  )
}
