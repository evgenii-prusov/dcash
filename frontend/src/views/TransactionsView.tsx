import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Ic } from '../components/Icon'
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useCreateTransfer,
  useDeleteTransaction,
  useDeleteTransfer,
  useLedger,
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

function TxRow({
  entry,
  locale,
  onDelete,
}: {
  entry: LedgerEntry
  locale: string
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)

  if (entry.type === 'transfer') {
    const tr = entry as { type: 'transfer' } & Transfer
    return (
      <div className="txn-row">
        <span className="badge b-tfr mt-0.5 shrink-0">{t('ledger.transfer')}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
            {tr.from_account_name} → {tr.to_account_name}
          </div>
          {tr.note && <div className="text-[11px] text-text-3">{tr.note}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="tnum text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
            {formatMoney(tr.from_amount_minor, tr.from_currency, locale)}
            {tr.from_currency !== tr.to_currency && (
              <> → {formatMoney(tr.to_amount_minor, tr.to_currency, locale)}</>
            )}
          </span>
          <span className="text-[11px] text-text-3">{tr.date}</span>
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

  return (
    <div className="txn-row">
      <span className={`badge mt-0.5 shrink-0 ${isIncome ? 'b-inc' : 'b-exp'}`}>
        {isIncome ? t('ledger.income') : t('ledger.expense')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium">{tx.category_name}</span>
          <span className="text-[11px] text-text-3">{tx.group_name}</span>
        </div>
        {tx.payee && <div className="text-[11px] text-text-3">{tx.payee}</div>}
        {tx.note && <div className="text-[11px] text-text-3">{tx.note}</div>}
        <div className="text-[11px] text-text-3">{tx.account_name}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={`tnum text-[13px] font-medium ${amountColor}`}>
          {amountSign}
          {formatMoney(tx.amount_minor, tx.currency, locale)}
        </span>
        <span className="text-[11px] text-text-3">{tx.date}</span>
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

// ---------------------------------------------------------------------------
// Quick-add row (transaction)
// ---------------------------------------------------------------------------

function QuickAddTx({
  groups,
  accountOptions,
  onAdded,
}: {
  groups: CategoryGroup[]
  accountOptions: { id: number; name: string; currency: string }[]
  onAdded: () => void
}) {
  const { t } = useTranslation()
  const createTx = useCreateTransaction()

  const allCats = useMemo(() => groups.flatMap((g) => g.categories.map((c) => ({ ...c, groupKind: g.kind }))), [groups])

  const [accountId, setAccountId] = useState<number>(accountOptions[0]?.id ?? 0)
  const [categoryId, setCategoryId] = useState<number>(allCats[0]?.id ?? 0)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [payee, setPayee] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amountMinor = Math.round(parseFloat(amount) * 100)
    if (!amount || isNaN(amountMinor) || amountMinor <= 0) return setError(t('ledger.invalidAmount'))
    if (!accountId || !categoryId) return setError(t('ledger.selectAccountCategory'))
    try {
      await createTx.mutateAsync({ account_id: accountId, category_id: categoryId, amount_minor: amountMinor, date, payee: payee || null })
      setAmount('')
      setPayee('')
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
        <select className="sel" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
        <select className="sel" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
          {groups.map((g) =>
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
        <input
          className="input tnum w-28"
          type="number"
          step="0.01"
          placeholder={t('ledger.amount')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input className="input w-32" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          className="input flex-1"
          placeholder={t('ledger.payee')}
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
        />
        <button type="submit" className="btn btn-p btn-s" disabled={createTx.isPending}>
          <Ic n="plus" s={12} />
          {createTx.isPending ? t('common.saving') : t('ledger.addTransaction')}
        </button>
      </div>
    </form>
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

  const accountOptions = (accounts ?? []).filter((a) => !a.archived)

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
            <QuickAddTx
              groups={groups}
              accountOptions={accountOptions}
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
        {(entries ?? []).map((entry) => (
          <TxRow
            key={`${entry.type}-${entry.id}`}
            entry={entry}
            locale={locale}
            onDelete={() => {
              if (entry.type === 'transaction') deleteTx.mutate(entry.id)
              else deleteTransfer.mutate(entry.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}
