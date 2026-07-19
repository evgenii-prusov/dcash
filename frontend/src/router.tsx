import { useState } from 'react'
import { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './components/Sidebar'
import { Placeholder } from './components/Placeholder'
import type { IconName } from './components/Icon'

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <div className="flex h-dvh">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex flex-col gap-[5px] p-1"
            aria-label="Open menu"
          >
            <span className="block h-[2px] w-5 bg-ink" />
            <span className="block h-[2px] w-5 bg-ink" />
            <span className="block h-[2px] w-5 bg-ink" />
          </button>
        </div>
        <div className="max-w-[880px] px-4 py-6 md:px-12 md:py-9">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

// Placeholder pages: each is replaced by its real view when the matching
// epic lands (dashboard/E5, ledger/E3, accounts/E3, budgets/E6, recurring/E7,
// settings/E2+).
function makePlaceholderView(nameKey: 'dashboard' | 'transactions' | 'accounts' | 'budgets' | 'recurring' | 'settings', icon: IconName) {
  return function PlaceholderView() {
    const { t } = useTranslation()
    return (
      <Placeholder
        icon={icon}
        title={t(`nav.${nameKey}`)}
        sub={t('placeholder.soon')}
        text={t(`placeholder.${nameKey}`)}
      />
    )
  }
}

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Layout })

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: makePlaceholderView('dashboard', 'dashboard'),
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: makePlaceholderView('transactions', 'transactions'),
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts',
  component: makePlaceholderView('accounts', 'accounts'),
})

const budgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budgets',
  component: makePlaceholderView('budgets', 'budgets'),
})

const recurringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: makePlaceholderView('recurring', 'recurring'),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: makePlaceholderView('settings', 'settings'),
})

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  transactionsRoute,
  accountsRoute,
  budgetsRoute,
  recurringRoute,
  settingsRoute,
])

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, context: { queryClient }, history })
}

export const queryClient = new QueryClient()

export const router = createAppRouter(queryClient)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
