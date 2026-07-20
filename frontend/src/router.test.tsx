import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { createMemoryHistory } from '@tanstack/react-router'
import { createAppRouter } from './router'

const MOCK_USER = { id: 1, email: 'test@example.com' }

function mockApi(user: typeof MOCK_USER | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        if (user) return new Response(JSON.stringify(user), { status: 200 })
        return new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 })
      }
      if (url === '/api/auth/providers') {
        return new Response(JSON.stringify({ google: false, github: false }), { status: 200 })
      }
      // E3 data endpoints: return empty arrays so views render without errors
      if (url === '/api/accounts/') return new Response('[]', { status: 200 })
      if (url === '/api/categories/') return new Response('[]', { status: 200 })
      if (url.startsWith('/api/ledger/')) return new Response('[]', { status: 200 })
      return new Response('Not found', { status: 404 })
    }),
  )
}

async function renderAt(path: string, user: typeof MOCK_USER | null = null) {
  mockApi(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await router.load()
  return router
}

describe('route guard', () => {
  afterEach(() => vi.restoreAllMocks())

  test('anonymous visitor at / is redirected to /welcome', async () => {
    const router = await renderAt('/')
    expect(router.state.location.pathname).toBe('/welcome')
    expect(await screen.findByText('Create an account')).toBeInTheDocument()
  })

  test('anonymous visitor at /transactions is redirected to /welcome', async () => {
    const router = await renderAt('/transactions')
    expect(router.state.location.pathname).toBe('/welcome')
  })

  test('authenticated user at / sees the app layout', async () => {
    await renderAt('/', MOCK_USER)
    expect(await screen.findByText('DCash')).toBeInTheDocument()
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1)
  })

  test('authenticated user at /welcome is redirected to /', async () => {
    const router = await renderAt('/welcome', MOCK_USER)
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('existing app shell tests (authenticated)', () => {
  afterEach(() => vi.restoreAllMocks())

  test('renders the app shell with all nav sections', async () => {
    await renderAt('/', MOCK_USER)
    for (const label of ['Transactions', 'Accounts', 'Budgets', 'Recurring', 'Settings']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(2)
  })

  test('accounts route renders the accounts view', async () => {
    await renderAt('/accounts', MOCK_USER)
    expect((await screen.findAllByText('Accounts')).length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
  })

  test('language toggle switches the UI to Russian and back', async () => {
    await renderAt('/', MOCK_USER)
    await userEvent.click(await screen.findByText('Русский'))
    expect(await screen.findByText('Операции')).toBeInTheDocument()
    await userEvent.click(screen.getByText('English'))
    expect(await screen.findByText('Transactions')).toBeInTheDocument()
  })

  test('theme toggle flips the data-theme attribute', async () => {
    await renderAt('/', MOCK_USER)
    await screen.findByText('DCash')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    await userEvent.click(screen.getByText('Dark mode'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await userEvent.click(screen.getByText('Light mode'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
