import { useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Ic } from '../components/Icon'
import { CategoryPicker } from '../components/CategoryPicker'
import { OmniboxAdd } from '../components/OmniboxAdd'
import {
  useAccounts,
  useCategories,
  useCreateTransfer,
  useDeleteSplitGroup,
  useDeleteTransaction,
  useDeleteTransfer,
  useLedger,
  usePatchTransaction,
  useSplitTransaction,
} from '../api/hooks'
import type { CategoryGroup, LedgerEntry, Transaction, Transfer } from '../api/types'

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

/** Parses a raw amount input into minor units, the file's existing
 * `Math.round(parseFloat(x) * 100)` convention, guarded against NaN so a
 * half-typed split line reads as 0 rather than poisoning sums. */
function parseAmountMinor(raw: string): number {
  const minor = Math.round(parseFloat(raw) * 100)
  return Number.isNaN(minor) ? 0 : minor
}

function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym: string, locale: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

interface SplitLine {
  id: number
  categoryId: number | null
  amountStr: string
}

function TxRow({
  entry,
  locale,
  groups,
  splitBadge,
  onDelete,
}: {
  entry: LedgerEntry
  locale: string
  /** Household's category groups — threaded down so the split editor's
   * CategoryPicker lines share the same query as everywhere else. */
  groups: CategoryGroup[]
  /** Set when this row is a split child being rendered flat (a category or
   * search filter could otherwise return a misleading partial group total —
   * see the grouping logic in TransactionsView). */
  splitBadge?: boolean
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [lines, setLines] = useState<SplitLine[]>([])
  const [splitError, setSplitError] = useState('')
  const nextLineId = useRef(0)
  const splitTx = useSplitTransaction()

  // Inline edit — the only way to correct a record after creation
  // (payee especially, which is easy to skip while entering at the till).
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ categoryId: 0, amountStr: '', date: '', payee: '', note: '' })
  const [editError, setEditError] = useState('')
  const patchTx = usePatchTransaction()

  if (entry.type === 'transfer') {
    const tr = entry as { type: 'transfer' } & Transfer
    return (
      <div className="txn-row items-center">
        <span className="badge b-tfr shrink-0">{t('ledger.transfer')}</span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
            {tr.from_account_name} → {tr.to_account_name}
          </span>
          {tr.note && <span className="truncate text-[11px] text-text-3">· {tr.note}</span>}
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="tnum text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
            {formatMoney(tr.from_amount_minor, tr.from_currency, locale)}
            {tr.from_currency !== tr.to_currency && (
              <> → {formatMoney(tr.to_amount_minor, tr.to_currency, locale)}</>
            )}
          </span>
          {(tr.from_currency !== 'EUR' || tr.to_currency !== 'EUR') && (
            <span className="tnum text-[11px] text-text-3 font-normal">
              ~{formatMoney(tr.from_amount_eur_minor, 'EUR', locale)}
              {tr.from_currency !== tr.to_currency && (
                <> → ~{formatMoney(tr.to_amount_eur_minor, 'EUR', locale)}</>
              )}
            </span>
          )}
          <span className="tnum shrink-0 text-[11px] text-text-3">{tr.date}</span>
        </div>
        {confirm ? (
          <div className="flex gap-1">
            <button className="btn btn-danger btn-s" onClick={onDelete}>
              <Ic n="check" s={11} />
            </button>
            <button className="btn btn-g btn-s" onClick={() => setConfirm(false)}>
              <Ic n="x" s={11} />
            </button>
          </div>
        ) : (
          <button className="btn btn-g btn-s" onClick={() => setConfirm(true)}>
            <Ic n="trash" s={11} />
          </button>
        )}
      </div>
    )
  }

  const tx = entry as { type: 'transaction' } & Transaction
  const isIncome = tx.kind === 'income'
  const amountColor = isIncome ? 'text-income' : ''
  const amountSign = isIncome ? '+' : ''

  function openSplit() {
    nextLineId.current = 1
    setLines([{ id: 0, categoryId: tx.category_id, amountStr: (tx.amount_minor / 100).toFixed(2) }])
    setSplitError('')
    setSplitOpen(true)
  }

  function addLine() {
    setLines((prev) => {
      const usedMinor = prev.reduce((sum, l) => sum + parseAmountMinor(l.amountStr), 0)
      const remainingMinor = tx.amount_minor - usedMinor
      const id = nextLineId.current++
      return [...prev, { id, categoryId: null, amountStr: (remainingMinor / 100).toFixed(2) }]
    })
  }

  function updateLine(id: number, patch: Partial<SplitLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const usedMinor = lines.reduce((sum, l) => sum + parseAmountMinor(l.amountStr), 0)
  const remainingMinor = tx.amount_minor - usedMinor
  // Mirrors the server rule (backend/app/transactions.py: _validated_split_kind)
  // rather than replacing it — this only spares the user a rejected round trip.
  const canSave =
    remainingMinor === 0 &&
    lines.length >= 2 &&
    lines.every((l) => l.categoryId != null && parseAmountMinor(l.amountStr) > 0)

  function openEdit() {
    setEdit({
      categoryId: tx.category_id,
      amountStr: (tx.amount_minor / 100).toFixed(2),
      date: tx.date,
      payee: tx.payee ?? '',
      note: tx.note ?? '',
    })
    setEditError('')
    setEditOpen(true)
  }

  function handleEditSave() {
    setEditError('')
    const amountMinor = parseAmountMinor(edit.amountStr)
    if (amountMinor <= 0) return setEditError(t('ledger.invalidAmount'))
    patchTx.mutate(
      {
        id: tx.id,
        data: {
          category_id: edit.categoryId,
          amount_minor: amountMinor,
          date: edit.date,
          // Empty string clears the field server-side; null is the "unset" value.
          payee: edit.payee.trim() || null,
          note: edit.note.trim() || null,
        },
      },
      {
        onSuccess: () => setEditOpen(false),
        onError: (err: unknown) => setEditError(err instanceof Error ? err.message : t('common.genericError')),
      },
    )
  }

  function handleSave() {
    setSplitError('')
    splitTx.mutate(
      {
        id: tx.id,
        payload: {
          lines: lines.map((l) => ({
            category_id: l.categoryId as number,
            amount_minor: parseAmountMinor(l.amountStr),
          })),
        },
      },
      {
        onSuccess: () => setSplitOpen(false),
        onError: (err: unknown) => setSplitError(err instanceof Error ? err.message : t('common.genericError')),
      },
    )
  }

  return (
    <>
      <div className="txn-row items-center">
        <span className={`badge shrink-0 ${isIncome ? 'b-inc' : 'b-exp'}`}>
          {isIncome ? t('ledger.income') : t('ledger.expense')}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 text-[13px] font-medium">{tx.category_name}</span>
          <span className="shrink-0 text-[11px] text-text-3">{tx.group_name}</span>
          {splitBadge && <span className="badge b-low shrink-0">{t('ledger.splitBadge')}</span>}
          {(tx.payee || tx.note) && (
            <span className="truncate text-[11px] text-text-3">
              · {[tx.payee, tx.note].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-text-3">{tx.account_name}</span>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className={`tnum text-[13px] font-medium ${amountColor}`}>
            {amountSign}
            {formatMoney(tx.amount_minor, tx.currency, locale)}
          </span>
          {tx.currency !== 'EUR' && (
            <span className="tnum text-[11px] text-text-3 font-normal">
              (~{amountSign}{formatMoney(tx.amount_eur_minor, 'EUR', locale)})
            </span>
          )}
          <span className="tnum shrink-0 text-[11px] text-text-3">{tx.date}</span>
        </div>
        {confirm ? (
          <div className="flex gap-1">
            <button className="btn btn-danger btn-s" onClick={onDelete}>
              <Ic n="check" s={11} />
            </button>
            <button className="btn btn-g btn-s" onClick={() => setConfirm(false)}>
              <Ic n="x" s={11} />
            </button>
          </div>
        ) : (
          <div className="flex gap-1">
            <button
              className={`btn btn-s ${editOpen ? 'btn-p' : 'btn-g'}`}
              title={t('ledger.editEntry')}
              onClick={() => (editOpen ? setEditOpen(false) : openEdit())}
            >
              <Ic n="edit" s={11} />
            </button>
            {tx.split_group_id === null && (
              <button
                className={`btn btn-s ${splitOpen ? 'btn-p' : 'btn-g'}`}
                onClick={() => (splitOpen ? setSplitOpen(false) : openSplit())}
              >
                {t('ledger.split')}
              </button>
            )}
            <button className="btn btn-g btn-s" onClick={() => setConfirm(true)}>
              <Ic n="trash" s={11} />
            </button>
          </div>
        )}
      </div>

      {editOpen && (
        <div className="flex flex-col gap-2 border-b border-line bg-surface-2 px-4 py-3">
          <div className="text-[12px] font-medium">{t('ledger.editEntry')}</div>
          {editError && <p className="text-[12px] text-warn">{editError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <CategoryPicker
              groups={groups}
              value={edit.categoryId}
              onSelect={(sel) => setEdit((p) => ({ ...p, categoryId: sel.id }))}
              kindFilter={tx.kind}
              className="min-w-[10rem] flex-1"
            />
            <input
              className="input tnum w-24"
              type="number"
              step="0.01"
              value={edit.amountStr}
              onChange={(e) => setEdit((p) => ({ ...p, amountStr: e.target.value }))}
            />
            <input
              className="input w-32"
              type="date"
              value={edit.date}
              onChange={(e) => setEdit((p) => ({ ...p, date: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[10rem] flex-1"
              placeholder={t('ledger.payee')}
              value={edit.payee}
              onChange={(e) => setEdit((p) => ({ ...p, payee: e.target.value }))}
            />
            <input
              className="input min-w-[10rem] flex-1"
              placeholder={t('ledger.note')}
              value={edit.note}
              onChange={(e) => setEdit((p) => ({ ...p, note: e.target.value }))}
            />
            <button className="btn btn-p btn-s" onClick={handleEditSave} disabled={patchTx.isPending}>
              {patchTx.isPending ? t('common.saving') : t('common.save')}
            </button>
            <button className="btn btn-g btn-s" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {splitOpen && (
        <div className="flex flex-col gap-2 border-b border-line bg-surface-2 px-4 py-3">
          <div className="text-[12px] font-medium">
            {t('ledger.splitTitle', { amount: formatMoney(tx.amount_minor, tx.currency, locale) })}
          </div>
          {lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <CategoryPicker
                groups={groups}
                value={line.categoryId}
                onSelect={(sel) => updateLine(line.id, { categoryId: sel.id })}
                kindFilter={tx.kind}
                className="flex-1"
              />
              <input
                className="input tnum w-24"
                type="number"
                step="0.01"
                value={line.amountStr}
                onChange={(e) => updateLine(line.id, { amountStr: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-g btn-s"
                disabled={lines.length <= 1}
                onClick={() => removeLine(line.id)}
              >
                <Ic n="x" s={11} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="btn btn-g btn-s" onClick={addLine}>
              <Ic n="plus" s={11} />
              {t('ledger.addLine')}
            </button>
            <span
              className="tnum text-[12px] font-medium"
              style={remainingMinor !== 0 ? { color: 'var(--warn)' } : undefined}
            >
              {t('ledger.remaining')}: {formatMoney(remainingMinor, tx.currency, locale)}
            </span>
          </div>
          {!canSave && (
            <p className="text-[11px] text-text-3">
              {lines.length < 2 ? t('ledger.splitNeedsTwoLines') : t('ledger.splitMustMatchTotal')}
            </p>
          )}
          {splitError && <p className="text-[12px] text-warn">{splitError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-g btn-s" onClick={() => setSplitOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-p btn-s"
              disabled={!canSave || splitTx.isPending}
              onClick={handleSave}
            >
              {splitTx.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Split group row — one collapsible header for all siblings sharing a
// split_group_id, plus their child lines when expanded.
// ---------------------------------------------------------------------------

function SplitGroupRow({
  entries,
  locale,
  onDeleteGroup,
}: {
  entries: Transaction[]
  locale: string
  onDeleteGroup: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [confirm, setConfirm] = useState(false)

  // Sort key is (date, created_at) per the plan — siblings share a date, so
  // this settles into insertion order (original line first).
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)),
    [entries],
  )
  const first = sorted[0]
  const totalMinor = sorted.reduce((sum, e) => sum + e.amount_minor, 0)
  const totalEurMinor = sorted.reduce((sum, e) => sum + e.amount_eur_minor, 0)
  const isIncome = first.kind === 'income'
  const amountColor = isIncome ? 'text-income' : ''
  const amountSign = isIncome ? '+' : ''
  const label = first.payee || first.account_name

  return (
    <>
      <div className="txn-row items-center">
        <button
          type="button"
          className="btn btn-g btn-s shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span
            style={{
              display: 'inline-flex',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.12s',
            }}
          >
            <Ic n="chevron-right" s={11} />
          </span>
        </button>
        <span className={`badge shrink-0 ${isIncome ? 'b-inc' : 'b-exp'}`}>
          {isIncome ? t('ledger.income') : t('ledger.expense')}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium">{label}</span>
          <span className="shrink-0 text-[11px] text-text-3">
            {t('ledger.splitBadge')} · {sorted.length}
          </span>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className={`tnum text-[13px] font-medium ${amountColor}`}>
            {amountSign}
            {formatMoney(totalMinor, first.currency, locale)}
          </span>
          {first.currency !== 'EUR' && (
            <span className="tnum text-[11px] text-text-3 font-normal">
              (~{amountSign}{formatMoney(totalEurMinor, 'EUR', locale)})
            </span>
          )}
          <span className="tnum shrink-0 text-[11px] text-text-3">{first.date}</span>
        </div>
        {confirm ? (
          <div className="flex gap-1">
            <button className="btn btn-danger btn-s" onClick={onDeleteGroup}>
              <Ic n="check" s={11} />
            </button>
            <button className="btn btn-g btn-s" onClick={() => setConfirm(false)}>
              <Ic n="x" s={11} />
            </button>
          </div>
        ) : (
          <button className="btn btn-g btn-s" title={t('ledger.deleteSplit')} onClick={() => setConfirm(true)}>
            <Ic n="trash" s={11} />
          </button>
        )}
      </div>
      {expanded &&
        sorted.map((tx) => (
          <div key={tx.id} className="txn-row items-center pl-10">
            <span className={`badge shrink-0 ${tx.kind === 'income' ? 'b-inc' : 'b-exp'}`}>
              {tx.kind === 'income' ? t('ledger.income') : t('ledger.expense')}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 text-[13px] font-medium">{tx.category_name}</span>
              <span className="shrink-0 text-[11px] text-text-3">{tx.group_name}</span>
              {tx.note && <span className="truncate text-[11px] text-text-3">· {tx.note}</span>}
            </div>
            <div className="flex shrink-0 items-baseline gap-2">
              <span className={`tnum text-[13px] font-medium ${tx.kind === 'income' ? 'text-income' : ''}`}>
                {tx.kind === 'income' ? '+' : ''}
                {formatMoney(tx.amount_minor, tx.currency, locale)}
              </span>
              {tx.currency !== 'EUR' && (
                <span className="tnum text-[11px] text-text-3 font-normal">
                  (~{tx.kind === 'income' ? '+' : ''}
                  {formatMoney(tx.amount_eur_minor, 'EUR', locale)})
                </span>
              )}
            </div>
          </div>
        ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Quick-add transfer
// ---------------------------------------------------------------------------

function QuickAddTransfer({
  accountOptions,
  onAdded,
}: {
  accountOptions: { id: number; name: string; currency: string }[]
  onAdded: () => void
}) {
  const { t } = useTranslation()
  const createTransfer = useCreateTransfer()
  const [fromId, setFromId] = useState<number>(accountOptions[0]?.id ?? 0)
  const [toId, setToId] = useState<number>(accountOptions[1]?.id ?? accountOptions[0]?.id ?? 0)
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [error, setError] = useState('')

  const fromCurrency = accountOptions.find((a) => a.id === fromId)?.currency ?? ''
  const toCurrency = accountOptions.find((a) => a.id === toId)?.currency ?? ''
  const isCrossCurrency = fromCurrency !== toCurrency

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const fromMinor = Math.round(parseFloat(fromAmount) * 100)
    const toMinor = isCrossCurrency ? Math.round(parseFloat(toAmount) * 100) : fromMinor
    if (!fromAmount || isNaN(fromMinor) || fromMinor <= 0) return setError(t('ledger.invalidAmount'))
    if (fromId === toId) return setError(t('ledger.sameAccount'))
    try {
      await createTransfer.mutateAsync({ from_account_id: fromId, to_account_id: toId, from_amount_minor: fromMinor, to_amount_minor: toMinor, date })
      setFromAmount('')
      setToAmount('')
      setDate(todayISO())
      onAdded()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.genericError'))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-b border-line px-4 py-3">
      {error && <p className="text-[12px] text-warn">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <select className="sel" value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
        <span className="self-center text-text-3">→</span>
        <select className="sel" value={toId} onChange={(e) => setToId(Number(e.target.value))}>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
        <input
          className="input tnum w-28"
          type="number"
          step="0.01"
          placeholder={`${t('ledger.amount')} ${fromCurrency}`}
          value={fromAmount}
          onChange={(e) => {
            setFromAmount(e.target.value)
            if (!isCrossCurrency) setToAmount(e.target.value)
          }}
        />
        {isCrossCurrency && (
          <input
            className="input tnum w-28"
            type="number"
            step="0.01"
            placeholder={`${t('ledger.amount')} ${toCurrency}`}
            value={toAmount}
            onChange={(e) => setToAmount(e.target.value)}
          />
        )}
        <input className="input w-32" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="submit" className="btn btn-p btn-s" disabled={createTransfer.isPending}>
          <Ic n="transfer" s={12} />
          {createTransfer.isPending ? t('common.saving') : t('ledger.addTransfer')}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function TransactionsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-GB'

  const [month, setMonth] = useState(currentMonth)
  const [filterAccountId, setFilterAccountId] = useState<number | undefined>()
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>()
  const [q, setQ] = useState('')
  const [addMode, setAddMode] = useState<'none' | 'transaction' | 'transfer'>('none')

  const { data: accounts } = useAccounts()
  const { data: groups } = useCategories()
  const { data: entries, isLoading } = useLedger({
    month,
    account_id: filterAccountId,
    category_id: filterCategoryId,
    q: q || undefined,
  })
  const deleteTx = useDeleteTransaction()
  const deleteTransfer = useDeleteTransfer()
  const deleteSplitGroup = useDeleteSplitGroup()

  const accountOptions = (accounts ?? []).filter((a) => !a.archived)

  // A category or search filter can return only part of a split group (a
  // sibling's own category doesn't match, or its own note doesn't match the
  // search text) — summing a partial group into one header would lie about
  // the total, so those two filters force flat rendering with a badge
  // instead. The account filter is safe: siblings always share account_id,
  // so the whole group comes back together.
  const forceFlatSplits = filterCategoryId !== undefined || q.trim() !== ''

  // Fold the ledger into render nodes. Grouping is by split_group_id, never
  // by row adjacency: a group node collects every entry sharing that id
  // wherever it sits in the list, so correctness doesn't depend on siblings
  // landing next to each other.
  const renderNodes = useMemo(() => {
    type RenderNode =
      | { kind: 'entry'; entry: LedgerEntry }
      | { kind: 'group'; groupId: number; entries: Transaction[] }

    const list = entries ?? []
    if (forceFlatSplits) {
      return list.map((entry): RenderNode => ({ kind: 'entry', entry }))
    }

    const byGroup = new Map<number, Transaction[]>()
    for (const entry of list) {
      if (entry.type === 'transaction' && entry.split_group_id != null) {
        const arr = byGroup.get(entry.split_group_id) ?? []
        arr.push(entry)
        byGroup.set(entry.split_group_id, arr)
      }
    }

    const seenGroups = new Set<number>()
    const nodes: RenderNode[] = []
    for (const entry of list) {
      if (entry.type === 'transaction' && entry.split_group_id != null) {
        if (seenGroups.has(entry.split_group_id)) continue
        seenGroups.add(entry.split_group_id)
        nodes.push({ kind: 'group', groupId: entry.split_group_id, entries: byGroup.get(entry.split_group_id)! })
      } else {
        nodes.push({ kind: 'entry', entry })
      }
    }
    return nodes
  }, [entries, forceFlatSplits])

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">{t('nav.transactions')}</div>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn btn-s ${addMode === 'transaction' ? 'btn-p' : 'btn-g'}`}
            onClick={() => setAddMode(addMode === 'transaction' ? 'none' : 'transaction')}
          >
            <Ic n="plus" s={12} />
            {t('ledger.addTransaction')}
          </button>
          <button
            className={`btn btn-s ${addMode === 'transfer' ? 'btn-p' : 'btn-g'}`}
            onClick={() => setAddMode(addMode === 'transfer' ? 'none' : 'transfer')}
          >
            <Ic n="transfer" s={12} />
            {t('ledger.addTransfer')}
          </button>
        </div>
      </div>

      {/* Month switcher */}
      <div className="mb-4 flex items-center gap-3">
        <button className="btn btn-g btn-s" onClick={() => setMonth(prevMonth(month))}>
          <Ic n="chevron-left" s={12} />
        </button>
        <span className="min-w-[140px] text-center text-[14px] font-medium">{monthLabel(month, locale)}</span>
        <button className="btn btn-g btn-s" onClick={() => setMonth(nextMonth(month))}>
          <Ic n="chevron-right" s={12} />
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative">
          <Ic n="search" s={13} c="var(--text-3)" />
          <input
            className="input h-[30px] w-40 pl-7 text-[12px]"
            placeholder={t('ledger.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: '28px' }}
          />
        </div>
        <select
          className="sel"
          value={filterAccountId ?? ''}
          onChange={(e) => setFilterAccountId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{t('ledger.allAccounts')}</option>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="sel"
          value={filterCategoryId ?? ''}
          onChange={(e) => setFilterCategoryId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{t('ledger.allCategories')}</option>
          {(groups ?? []).map((g) =>
            g.categories.length > 0 ? (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null
          )}
        </select>
      </div>

      {/* Quick-add panel */}
      {addMode !== 'none' && (
        <div className="card mb-4">
          <div className="card-head">
            <h3>{addMode === 'transaction' ? t('ledger.addTransaction') : t('ledger.addTransfer')}</h3>
            <button className="btn btn-g btn-s" onClick={() => setAddMode('none')}>
              <Ic n="x" s={12} />
            </button>
          </div>
          {addMode === 'transaction' && groups && accountOptions.length > 0 && (
            <OmniboxAdd
              groups={groups}
              accounts={accounts ?? []}
              onAdded={() => setAddMode('none')}
            />
          )}
          {addMode === 'transfer' && accountOptions.length > 0 && (
            <QuickAddTransfer accountOptions={accountOptions} onAdded={() => setAddMode('none')} />
          )}
          {accountOptions.length === 0 && (
            <p className="px-4 py-3 text-[13px] text-text-3">{t('ledger.noAccountsYet')}</p>
          )}
        </div>
      )}

      {/* Ledger */}
      <div className="card">
        {isLoading && <p className="px-4 py-3 text-[13px] text-text-3">{t('common.loading')}</p>}
        {!isLoading && (!entries || entries.length === 0) && (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <p>{t('ledger.empty')}</p>
          </div>
        )}
        {renderNodes.map((node) => {
          if (node.kind === 'group') {
            return (
              <SplitGroupRow
                key={`split-${node.groupId}`}
                entries={node.entries}
                locale={locale}
                onDeleteGroup={() => deleteSplitGroup.mutate(node.groupId)}
              />
            )
          }
          const entry = node.entry
          return (
            <TxRow
              key={`${entry.type}-${entry.id}`}
              entry={entry}
              locale={locale}
              groups={groups ?? []}
              splitBadge={forceFlatSplits && entry.type === 'transaction' && entry.split_group_id != null}
              onDelete={() => {
                if (entry.type === 'transaction') deleteTx.mutate(entry.id)
                else deleteTransfer.mutate(entry.id)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
