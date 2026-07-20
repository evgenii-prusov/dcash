import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ic } from '../components/Icon'
import {
  useCategories,
  useHousehold,
  useHouseholdInvites,
  useHouseholdMembers,
  useCreateInvite,
  useRevokeInvite,
  useRemoveMember,
  useRates,
  useOverrideRate,
  useRefreshRates,
} from '../api/hooks'
import { api } from '../api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CategoryGroup } from '../api/types'

// ---------------------------------------------------------------------------
// Categories editor
// ---------------------------------------------------------------------------

function CategoriesSection() {
  const { t } = useTranslation()
  const { data: groups, isLoading } = useCategories()
  const qc = useQueryClient()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupKind, setNewGroupKind] = useState<'expense' | 'income'>('expense')
  const [addingGroup, setAddingGroup] = useState(false)
  const [newCatNames, setNewCatNames] = useState<Record<number, string>>({})
  const [addingCat, setAddingCat] = useState<Record<number, boolean>>({})

  const createGroup = useMutation({
    mutationFn: (data: { name: string; kind: 'expense' | 'income' }) => api.createGroup(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
  const createCat = useMutation({
    mutationFn: (data: { group_id: number; name: string }) => api.createCategory(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
  const patchCat = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) => api.patchCategory(id, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    await createGroup.mutateAsync({ name: newGroupName.trim(), kind: newGroupKind })
    setNewGroupName('')
    setAddingGroup(false)
  }

  async function handleCreateCategory(groupId: number) {
    const name = newCatNames[groupId]?.trim()
    if (!name) return
    await createCat.mutateAsync({ group_id: groupId, name })
    setNewCatNames((prev) => ({ ...prev, [groupId]: '' }))
    setAddingCat((prev) => ({ ...prev, [groupId]: false }))
  }

  function handleArchiveCat(id: number, archived: boolean) {
    patchCat.mutate({ id, archived })
  }

  if (isLoading) return <p className="text-[13px] text-text-3">{t('common.loading')}</p>

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('settings.categories')}</h3>
        <button className="btn btn-g btn-s" onClick={() => setAddingGroup(!addingGroup)}>
          <Ic n="plus" s={12} />
          {t('settings.addGroup')}
        </button>
      </div>

      {addingGroup && (
        <form onSubmit={handleCreateGroup} className="flex gap-2 border-b border-line px-4 py-3">
          <input
            className="input flex-1"
            placeholder={t('settings.groupName')}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            autoFocus
          />
          <select
            className="sel"
            value={newGroupKind}
            onChange={(e) => setNewGroupKind(e.target.value as 'expense' | 'income')}
          >
            <option value="expense">{t('ledger.expense')}</option>
            <option value="income">{t('ledger.income')}</option>
          </select>
          <button type="submit" className="btn btn-p btn-s">
            {t('common.save')}
          </button>
          <button type="button" className="btn btn-g btn-s" onClick={() => setAddingGroup(false)}>
            <Ic n="x" s={12} />
          </button>
        </form>
      )}

      {(groups ?? []).map((g: CategoryGroup) => (
        <div key={g.id} className="border-b border-line last:border-0">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <span className={`badge ${g.kind === 'income' ? 'b-inc' : 'b-exp'}`}>{g.kind}</span>
              <span className="text-[13px] font-semibold">{g.name}</span>
            </div>
            <button className="btn btn-g btn-s" onClick={() => setAddingCat((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}>
              <Ic n="plus" s={11} />
            </button>
          </div>

          {addingCat[g.id] && (
            <div className="flex gap-2 px-4 pb-2">
              <input
                className="input flex-1 text-[12px]"
                placeholder={t('settings.categoryName')}
                value={newCatNames[g.id] ?? ''}
                onChange={(e) => setNewCatNames((prev) => ({ ...prev, [g.id]: e.target.value }))}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory(g.id)}
              />
              <button className="btn btn-p btn-s" onClick={() => handleCreateCategory(g.id)}>
                {t('common.save')}
              </button>
            </div>
          )}

          <div className="pl-8">
            {g.categories.map((c) => (
              <div key={c.id} className={`flex items-center justify-between py-1 pr-4 text-[13px] ${c.archived ? 'opacity-40' : ''}`}>
                <span>{c.name}</span>
                <button
                  className="btn btn-g btn-s"
                  onClick={() => handleArchiveCat(c.id, !c.archived)}
                  title={c.archived ? t('accounts.unarchive') : t('accounts.archive')}
                >
                  {c.archived ? '↩' : '📦'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Household section (members + invites)
// ---------------------------------------------------------------------------

function HouseholdSection() {
  const { t } = useTranslation()
  const { data: household } = useHousehold()
  const { data: members } = useHouseholdMembers()
  const { data: invites } = useHouseholdInvites()
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()
  const removeMember = useRemoveMember()

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <Ic n="settings" s={13} />
          {household?.name ?? t('settings.household')}
        </h3>
        <button className="btn btn-p btn-s" onClick={() => createInvite.mutate()}>
          <Ic n="plus" s={12} />
          {t('settings.createInvite')}
        </button>
      </div>

      {/* Active invites */}
      {invites && invites.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <p className="mb-2 text-[12px] font-medium text-text-3">{t('settings.activeInvites')}</p>
          {invites.map((inv) => (
            <div key={inv.id} className="mb-1 flex items-center justify-between">
              <code className="rounded bg-surface-2 px-2 py-0.5 text-[11px]">{inv.code}</code>
              <button className="btn btn-g btn-s" onClick={() => revokeInvite.mutate(inv.id)}>
                <Ic n="trash" s={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Members */}
      <div className="px-4 py-3">
        <p className="mb-2 text-[12px] font-medium text-text-3">{t('settings.members')}</p>
        {(members ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between py-1 text-[13px]">
            <div>
              <span>{m.email}</span>
              <span className={`badge ml-2 ${m.role === 'owner' ? 'b-green' : 'b-low'}`}>{m.role}</span>
            </div>
            {m.role !== 'owner' && (
              <button className="btn btn-g btn-s" onClick={() => removeMember.mutate(m.id)}>
                <Ic n="trash" s={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rates section
// ---------------------------------------------------------------------------

function RatesSection() {
  const { t } = useTranslation()
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const { data: rates, isLoading } = useRates(selectedDate)
  const refreshRates = useRefreshRates()
  const overrideRate = useOverrideRate()

  const [editingCurrency, setEditingCurrency] = useState<string | null>(null)
  const [overrideVal, setOverrideVal] = useState('')

  async function handleSaveOverride(currency: string) {
    if (!overrideVal.trim()) return
    await overrideRate.mutateAsync({
      date: selectedDate,
      currency,
      rate_to_eur: overrideVal.trim(),
    })
    setEditingCurrency(null)
    setOverrideVal('')
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <Ic n="refresh" s={13} />
          {t('rates.title')}
        </h3>
        <button
          className="btn btn-g btn-s"
          onClick={() => refreshRates.mutate()}
          disabled={refreshRates.isPending}
        >
          {refreshRates.isPending ? t('common.loading') : t('rates.refresh')}
        </button>
      </div>

      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[12px] font-medium text-text-3">Date</span>
        <input
          type="date"
          className="input text-[12px] py-1 px-2"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="px-4 py-3 text-[13px] text-text-3">{t('common.loading')}</p>
      ) : (
        <div>
          {(rates ?? []).map((r) => {
            const isEditing = editingCurrency === r.currency
            const rateNum = Number(r.rate_to_eur)
            const inverse = rateNum > 0 && r.currency !== 'EUR' ? (1 / rateNum).toFixed(4) : '-'

            return (
              <div key={r.currency} className="border-b border-line last:border-0 px-4 py-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{r.currency}</span>
                    <span className={`badge ${r.source === 'manual' ? 'b-inc' : 'b-low'}`}>
                      {t(`rates.${r.source}` as any)}
                    </span>
                  </div>

                  {r.currency !== 'EUR' && !isEditing && (
                    <div className="flex items-center gap-3">
                      <span className="tnum text-[12px] text-text-2">
                        1 {r.currency} = {r.rate_to_eur} € (~{inverse} {r.currency}/€)
                      </span>
                      <button
                        className="btn btn-g btn-s"
                        onClick={() => {
                          setEditingCurrency(r.currency)
                          setOverrideVal(r.rate_to_eur)
                        }}
                      >
                        {t('rates.override')}
                      </button>
                    </div>
                  )}

                  {r.currency === 'EUR' && (
                    <span className="tnum text-[12px] text-text-3">Base (1.0)</span>
                  )}
                </div>

                {isEditing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSaveOverride(r.currency)
                    }}
                    className="mt-2 flex items-center gap-2"
                  >
                    <input
                      className="input text-[12px] flex-1"
                      placeholder="0.9215"
                      value={overrideVal}
                      onChange={(e) => setOverrideVal(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="btn btn-p btn-s">
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-g btn-s"
                      onClick={() => setEditingCurrency(null)}
                    >
                      <Ic n="x" s={12} />
                    </button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main settings view
// ---------------------------------------------------------------------------

export function SettingsView() {
  const { t } = useTranslation()

  return (
    <div>
      <div className="ph">
        <div>
          <div className="ph-title">{t('nav.settings')}</div>
        </div>
      </div>

      <HouseholdSection />

      <div className="mt-6">
        <RatesSection />
      </div>

      <div className="mt-6">
        <CategoriesSection />
      </div>
    </div>
  )
}
