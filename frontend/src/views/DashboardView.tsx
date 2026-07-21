import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  useReportSummary,
  useReportCategories,
  useReportNetWorth,
  useLedger,
} from '../api/hooks'
import { Ic } from '../components/Icon'

const CATEGORY_COLORS = [
  '#5a7a5f', // sage green
  '#4a6b8a', // transfer blue
  '#c05a22', // warning orange
  '#b0432f', // expense red
  '#9a5a10', // attention gold
  '#3e8e4f', // positive green
  '#7aaf80', // light sage
  '#7a9fc0', // light blue
]

function formatMoney(minor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

function getLocalMonthString(d = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function DashboardView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const [currentMonth, setCurrentMonth] = useState(() => getLocalMonthString())

  const { data: summary, isLoading: isSummaryLoading } = useReportSummary(currentMonth)
  const { data: categoriesReport } = useReportCategories(currentMonth, 'expense')
  const { data: netWorthReport } = useReportNetWorth()
  const { data: ledger } = useLedger({ month: currentMonth })

  function handleMonthChange(delta: number) {
    const [y, m] = currentMonth.split('-').map(Number)
    const dt = new Date(y, m - 1 + delta, 1)
    setCurrentMonth(getLocalMonthString(dt))
  }

  // Flatten group rollups for bar chart
  const categoryChartData = (categoriesReport?.groups ?? []).map((g) => ({
    name: g.group_name,
    value: g.total_eur_minor / 100,
    rawMinor: g.total_eur_minor,
  }))

  const netWorthChartData = (netWorthReport?.points ?? []).map((p) => ({
    month: p.month,
    value: p.net_worth_eur_minor / 100,
    rawMinor: p.net_worth_eur_minor,
  }))

  const recentLedger = (ledger ?? []).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Month selector header */}
      <div className="ph flex items-center justify-between">
        <div>
          <div className="ph-title">{t('nav.dashboard')}</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-g btn-s" onClick={() => handleMonthChange(-1)}>
            <Ic n="chevron-left" s={14} />
          </button>
          <span className="tnum font-medium text-[14px] px-2">{currentMonth}</span>
          <button className="btn btn-g btn-s" onClick={() => handleMonthChange(1)}>
            <Ic n="chevron-right" s={14} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {isSummaryLoading ? (
        <p className="text-[13px] text-text-3">{t('common.loading')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Income card */}
          <div className="card px-4 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
              {t('dashboard.income')}
            </span>
            <div className="tnum font-serif text-[26px] font-semibold text-income mt-1">
              +{formatMoney(summary?.income_eur_minor ?? 0, 'EUR', locale)}
            </div>
          </div>

          {/* Expenses card */}
          <div className="card px-4 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
              {t('dashboard.expenses')}
            </span>
            <div className="tnum font-serif text-[26px] font-semibold text-expense mt-1">
              {formatMoney(summary?.expenses_eur_minor ?? 0, 'EUR', locale)}
            </div>
          </div>

          {/* Net card */}
          <div className="card px-4 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
              {t('dashboard.net')}
            </span>
            <div
              className={`tnum font-serif text-[26px] font-semibold mt-1 ${
                (summary?.net_eur_minor ?? 0) >= 0 ? 'text-income' : 'text-expense'
              }`}
            >
              {(summary?.net_eur_minor ?? 0) >= 0 ? '+' : ''}
              {formatMoney(summary?.net_eur_minor ?? 0, 'EUR', locale)}
            </div>
          </div>
        </div>
      )}

      {/* Charts section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Category Spending Chart */}
        <div className="card">
          <div className="card-head">
            <h3>
              <Ic n="budgets" s={14} />
              {t('dashboard.spendingByCategory')}
            </h3>
          </div>
          <div className="p-4">
            {categoryChartData.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-3">{t('dashboard.noSpending')}</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" tickFormatter={(v) => `€${v}`} stroke="var(--text-3)" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={90} stroke="var(--text-2)" fontSize={11} />
                    <Tooltip
                      formatter={(val) => (val != null ? formatMoney(Math.round(Number(val) * 100), 'EUR', locale) : '')}
                      contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 6 }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {categoryChartData.map((_, idx) => (
                        <Cell key={`cell-${idx}`} fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Net Worth Trend Chart */}
        <div className="card">
          <div className="card-head">
            <h3>
              <Ic n="dashboard" s={14} />
              {t('dashboard.netWorthTrend')}
            </h3>
          </div>
          <div className="p-4">
            {netWorthChartData.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-3">{t('dashboard.noNetWorth')}</p>
            ) : (
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={netWorthChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" stroke="var(--text-3)" fontSize={11} />
                    <YAxis tickFormatter={(v) => `€${v}`} stroke="var(--text-3)" fontSize={11} />
                    <Tooltip
                      formatter={(val) => (val != null ? formatMoney(Math.round(Number(val) * 100), 'EUR', locale) : '')}
                      contentStyle={{ background: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 6 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#netWorthGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent entries */}
      <div className="card">
        <div className="card-head">
          <h3>
            <Ic n="transactions" s={14} />
            {t('dashboard.recentEntries')}
          </h3>
        </div>
        <div className="divide-y divide-line">
          {recentLedger.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-text-3">{t('ledger.empty')}</p>
          ) : (
            recentLedger.map((entry) => {
              if (entry.type === 'transfer') {
                return (
                  <div key={`tr-${entry.id}`} className="txn-row px-4 py-2.5">
                    <span className="badge b-tfr shrink-0">{t('ledger.transfer')}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
                        {entry.from_account_name} → {entry.to_account_name}
                      </div>
                      {entry.note && <div className="text-[11px] text-text-3">{entry.note}</div>}
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="tnum text-[13px] font-medium" style={{ color: 'var(--transfer)' }}>
                        {formatMoney(entry.from_amount_minor, entry.from_currency, locale)}
                      </span>
                      <span className="text-[11px] text-text-3">{entry.date}</span>
                    </div>
                  </div>
                )
              }

              const isIncome = entry.kind === 'income'
              return (
                <div key={`tx-${entry.id}`} className="txn-row px-4 py-2.5">
                  <span className={`badge shrink-0 ${isIncome ? 'b-inc' : 'b-exp'}`}>
                    {isIncome ? t('ledger.income') : t('ledger.expense')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[13px] font-medium">{entry.category_name}</div>
                      {entry.split_group_id != null && (
                        <span className="badge b-low shrink-0">{t('ledger.splitBadge')}</span>
                      )}
                    </div>
                    {entry.payee && <div className="text-[11px] text-text-3">{entry.payee}</div>}
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={`tnum text-[13px] font-medium ${isIncome ? 'text-income' : ''}`}>
                      {isIncome ? '+' : ''}
                      {formatMoney(entry.amount_minor, entry.currency, locale)}
                    </span>
                    <span className="text-[11px] text-text-3">{entry.date}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
