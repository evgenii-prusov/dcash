import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './components/Sidebar'
import { Placeholder } from './components/Placeholder'
import { WelcomeView } from './views/WelcomeView'
import { AccountsView } from './views/AccountsView'
import { TransactionsView } from './views/TransactionsView'
import { SettingsView } from './views/SettingsView'
import { DashboardView } from './views/DashboardView'
import { currentUserQueryOptions } from './api/hooks'
import { createQueryClient } from './queryClient'
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
function makePlaceholderView(
  nameKey: 'dashboard' | 'transactions' | 'accounts' | 'budgets' | 'recurring' | 'settings',
  icon: IconName,
) {
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

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet })

interface WelcomeSearch {
  oauth_error?: string
}

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  component: WelcomeView,
  validateSearch: (search: Record<string, unknown>): WelcomeSearch => ({
    oauth_error: typeof search.oauth_error === 'string' ? search.oauth_error : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(currentUserQueryOptions).catch(() => null)
    if (user) throw redirect({ to: '/' })
  },
})

// Pathless layout route: every child requires a session.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: Layout,
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(currentUserQueryOptions)
    } catch {
      throw redirect({ to: '/welcome' })
    }
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: DashboardView,
})

const transactionsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/transactions',
  component: TransactionsView,
})

const accountsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/accounts',
  component: AccountsView,
})

const budgetsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/budgets',
  component: makePlaceholderView('budgets', 'budgets'),
})

const recurringRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/recurring',
  component: makePlaceholderView('recurring', 'recurring'),
})

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsView,
})

const routeTree = rootRoute.addChildren([
  welcomeRoute,
  authedRoute.addChildren([
    dashboardRoute,
    transactionsRoute,
    accountsRoute,
    budgetsRoute,
    recurringRoute,
    settingsRoute,
  ]),
])

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, context: { queryClient }, history })
}

export const queryClient = createQueryClient({
  currentPath: () => router.state.location.pathname,
  redirectToWelcome: () => {
    // Drop any cached session so the /welcome guard doesn't bounce back to '/'.
    queryClient.removeQueries({ queryKey: ['auth'] })
    router.navigate({ to: '/welcome' })
  },
})

export const router = createAppRouter(queryClient)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
