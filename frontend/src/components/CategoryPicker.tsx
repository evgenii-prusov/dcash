import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateCategory } from '../api/hooks'
import type { Category, CategoryGroup } from '../api/types'
import { Ic } from './Icon'

/** What CategoryPicker hands back on a pick — id for callers that store a
 * foreign key (the split editor), name for callers that splice free text
 * (the omnibox), group info so either can show/record where it lives. */
export interface CategoryPickerSelection {
  id: number
  name: string
  groupId: number
  groupName: string
  kind: 'expense' | 'income'
}

export interface CategoryPickerProps {
  /** Household's category groups, e.g. from useCategories(). Passed down
   * rather than fetched here so several pickers on one screen (split
   * lines) share one query. */
  groups: CategoryGroup[]
  /** Currently selected category id, or null for none yet. Seeds the
   * input's display text when the dropdown is closed. */
  value: number | null
  /** Fired when the user picks an existing category, or once a newly
   * created one comes back from useCreateCategory(). */
  onSelect: (selection: CategoryPickerSelection) => void
  /** Restrict offered and creatable groups to one kind — every line of a
   * split must share the parent transaction's kind. Omit to offer both. */
  kindFilter?: 'expense' | 'income'
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

type Option =
  | { type: 'category'; category: Category; group: CategoryGroup }
  | { type: 'create' }
  | { type: 'create-in-group'; group: CategoryGroup }

export function CategoryPicker({
  groups,
  value,
  onSelect,
  kindFilter,
  placeholder,
  autoFocus,
  className,
}: CategoryPickerProps) {
  const { t } = useTranslation()
  const createCategory = useCreateCategory()

  const visibleGroups = useMemo(
    () => groups.filter((g) => !kindFilter || g.kind === kindFilter),
    [groups, kindFilter],
  )

  // Locate the currently selected category regardless of kindFilter/archived
  // — it may point at something no longer offered, but it must still show.
  const selected = useMemo(() => {
    for (const g of groups) {
      const c = g.categories.find((cat) => cat.id === value)
      if (c) return { category: c, group: g }
    }
    return null
  }, [groups, value])

  const [query, setQuery] = useState(selected?.category.name ?? '')
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Non-null while the user is choosing which group to create `creatingName` in.
  const [creatingName, setCreatingName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Keep the closed-field display in sync when the selection changes from
  // outside (e.g. a split line pre-filled by its parent).
  useEffect(() => {
    if (!open) setQuery(selected?.category.name ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const qLower = query.trim().toLowerCase()

  const matches = useMemo(() => {
    const out: { category: Category; group: CategoryGroup }[] = []
    for (const g of visibleGroups) {
      for (const c of g.categories) {
        if (c.archived) continue
        if (!qLower || c.name.toLowerCase().includes(qLower)) out.push({ category: c, group: g })
      }
    }
    return out
  }, [visibleGroups, qLower])

  const options: Option[] = useMemo(() => {
    if (creatingName !== null) {
      return visibleGroups.map((g) => ({ type: 'create-in-group', group: g }))
    }
    const opts: Option[] = matches.map((m) => ({ type: 'category', category: m.category, group: m.group }))
    if (qLower.length > 0 && matches.length === 0) opts.push({ type: 'create' })
    return opts
  }, [creatingName, matches, qLower, visibleGroups])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, creatingName])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreatingName(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function reset(displayName: string) {
    setQuery(displayName)
    setOpen(false)
    setCreatingName(null)
    setError('')
  }

  function selectOption(opt: Option) {
    if (opt.type === 'category') {
      onSelect({
        id: opt.category.id,
        name: opt.category.name,
        groupId: opt.group.id,
        groupName: opt.group.name,
        kind: opt.group.kind,
      })
      reset(opt.category.name)
      return
    }
    if (opt.type === 'create') {
      setCreatingName(query.trim())
      return
    }
    // create-in-group: actually create the category now.
    const name = creatingName ?? query.trim()
    const group = opt.group
    setError('')
    createCategory.mutate(
      { group_id: group.id, name },
      {
        onSuccess: (created) => {
          onSelect({
            id: created.id,
            name: created.name,
            groupId: group.id,
            groupName: group.name,
            kind: group.kind,
          })
          reset(created.name)
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : t('common.genericError'))
        },
      },
    )
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={dropdownRef}>
      <input
        className="input w-full"
        value={query}
        placeholder={placeholder ?? t('ledger.categoryPlaceholder')}
        autoFocus={autoFocus}
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setCreatingName(null)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (open && options.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelectedIndex((prev) => (prev + 1) % options.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelectedIndex((prev) => (prev - 1 + options.length) % options.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              selectOption(options[selectedIndex])
              return
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
            setCreatingName(null)
          }
        }}
      />

      {open && options.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-md">
          {options.map((opt, idx) => {
            const isActive = idx === selectedIndex
            const rowClass = `flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
              isActive ? 'bg-accent-2 text-accent font-medium' : 'text-ink hover:bg-surface-2'
            }`
            if (opt.type === 'category') {
              return (
                <button
                  key={`cat-${opt.category.id}`}
                  type="button"
                  className={rowClass}
                  onClick={() => selectOption(opt)}
                >
                  <span className="flex-1 truncate">{opt.category.name}</span>
                  <span className="shrink-0 text-[10px] uppercase text-ink-3">{opt.group.name}</span>
                </button>
              )
            }
            if (opt.type === 'create') {
              return (
                <button key="create" type="button" className={rowClass} onClick={() => selectOption(opt)}>
                  <Ic n="plus" s={12} />
                  <span>{t('ledger.createCategoryIn', { name: query.trim() })}</span>
                </button>
              )
            }
            return (
              <button
                key={`create-in-${opt.group.id}`}
                type="button"
                className={rowClass}
                disabled={createCategory.isPending}
                onClick={() => selectOption(opt)}
              >
                <span className={`badge ${opt.group.kind === 'income' ? 'b-inc' : 'b-exp'}`}>{opt.group.kind}</span>
                <span className="flex-1 truncate">{opt.group.name}</span>
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="mt-1 text-[12px] text-warn">{error}</p>}
    </div>
  )
}
