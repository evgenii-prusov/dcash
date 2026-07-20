import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ic } from '../components/Icon'
import { useAccounts, useCreateAccount, usePatchAccount } from '../api/hooks'
import type { Account, AccountCreate, AccountType } from '../api/types'

const ACCOUNT_TYPES: AccountType[] = ['savings', 'cash', 'card']
const CURRENCIES = ['EUR', 'USD', 'RUB']

function formatMoney(minor: number, currency: string, locale: string): string {
  const decimals = 2
  const value = minor / Math.pow(10, decimals)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
  } catch {
    return `${(minor / 100).toFixed(decimals)} ${currency}`
  }
}

function AccountTypeIcon({ type }: { type: AccountType }) {
  const icons: Record<AccountType, string> = {
    savings: '🐷',
    cash: '💵',
    card: '💳',
  }
  return <span className="text-base">{icons[type]}</span>
}

interface AccountFormProps {
  initial?: Partial<AccountCreate>
  onSave: (data: AccountCreate) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function AccountForm({ initial, onSave, onCancel, saving }: AccountFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AccountType>(initial?.type ?? 'savings')
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR')
  const [opening, setOpening] = useState(
    initial?.opening_balance_minor != null ? (initial.opening_balance_minor / 100).toFixed(2) : '0.00'
  )
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const parsedOpening = Math.round(parseFloat(opening) * 100)
    if (!name.trim()) return setError(t('accounts.form.nameRequired'))
    if (isNaN(parsedOpening)) return setError(t('accounts.form.invalidAmount'))
    try {
      await onSave({ name: name.trim(), type, currency, opening_balance_minor: parsedOpening })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.genericError'))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      {error && <p className="rounded-md bg-warn-2 px-3 py-2 text-[13px] text-warn">{error}</p>}
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-text-3">{t('accounts.form.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-[12px] text-text-3">{t('accounts.form.type')}</label>
          <select className="sel w-full" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-[12px] text-text-3">{t('accounts.form.currency')}</label>
          <select className="sel w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[12px] text-text-3">{t('accounts.form.openingBalance')}</label>
        <input
          className="input tnum"
          type="number"
          step="0.01"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-p btn-s" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn btn-g btn-s" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function AccountCard({ account, locale }: { account: Account; locale: string }) {
  const { t } = useTranslation()
  const patchAccount = usePatchAccount()
  const [editing, setEditing] = useState(false)

  const isNegative = account.balance_minor < 0
  const balanceColor = isNegative ? 'text-expense' : ''

  async function handleSave(data: { name?: string; opening_balance_minor?: number; archived?: boolean }) {
    await patchAccount.mutateAsync({ id: account.id, data })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>
            <AccountTypeIcon type={account.type} />
            {t('accounts.edit')}
          </h3>
          <button className="btn btn-g btn-s" onClick={() => setEditing(false)}>
            <Ic n="x" s={12} />
          </button>
        </div>
        <AccountForm
          initial={{
            name: account.name,
            type: account.type,
            currency: account.currency,
            opening_balance_minor: account.opening_balance_minor,
          }}
          onSave={async (d) => {
            await handleSave({ name: d.name, opening_balance_minor: d.opening_balance_minor })
          }}
          onCancel={() => setEditing(false)}
          saving={patchAccount.isPending}
        />
      </div>
    )
  }

  return (
    <div className={`card ${account.archived ? 'opacity-50' : ''}`}>
      <div className="card-head">
        <h3>
          <AccountTypeIcon type={account.type} />
          {account.name}
        </h3>
        <div className="flex items-center gap-1">
          <button className="btn btn-g btn-s" onClick={() => setEditing(true)}>
            <Ic n="edit" s={12} />
          </button>
          <button
            className="btn btn-g btn-s"
            onClick={() => patchAccount.mutate({ id: account.id, data: { archived: !account.archived } })}
            title={account.archived ? t('accounts.unarchive') : t('accounts.archive')}
          >
            {account.archived ? '↩' : '📦'}
          </button>
        </div>
      </div>
      <div className="flex items-end justify-between px-4 py-3">
        <span className="text-[11px] text-text-3">{account.currency}</span>
        <span className={`tnum text-[20px] font-semibold tracking-tight ${balanceColor}`}>
          {formatMoney(account.balance_minor, account.currency, locale)}
        </span>
      </div>
    </div>
  )
}

export function AccountsView() {
  const { t, i18n } = useTranslation()
  const { data: accounts, isLoading } = useAccounts()
  const createAccount = useCreateAccount()
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-GB'

  async function handleCreate(data: AccountCreate) {
    setAddError('')
    try {
      await createAccount.mutateAsync(data)
      setAdding(false)
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : t('common.genericError'))
      throw err
    }
  }

  const active = accounts?.filter((a) => !a.archived) ?? []
  const archived = accounts?.filter((a) => a.archived) ?? []

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">{t('nav.accounts')}</div>
        </div>
        <button className="btn btn-p" onClick={() => setAdding(true)}>
          <Ic n="plus" s={13} />
          {t('accounts.addAccount')}
        </button>
      </div>

      {adding && (
        <div className="card mb-4">
          <div className="card-head">
            <h3>{t('accounts.newAccount')}</h3>
            <button className="btn btn-g btn-s" onClick={() => setAdding(false)}>
              <Ic n="x" s={12} />
            </button>
          </div>
          {addError && <p className="px-4 pt-2 text-[13px] text-warn">{addError}</p>}
          <AccountForm onSave={handleCreate} onCancel={() => setAdding(false)} saving={createAccount.isPending} />
        </div>
      )}

      {isLoading && <p className="text-[13px] text-text-3">{t('common.loading')}</p>}

      {!isLoading && active.length === 0 && !adding && (
        <div className="empty">
          <div className="empty-icon">💳</div>
          <p>{t('accounts.empty')}</p>
        </div>
      )}

      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((a) => (
          <AccountCard key={a.id} account={a} locale={locale} />
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-[12px] font-medium text-text-3">{t('accounts.archived')}</p>
          <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((a) => (
              <AccountCard key={a.id} account={a} locale={locale} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
