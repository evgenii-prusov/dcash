import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { createMemoryHistory } from '@tanstack/react-router'
import { createAppRouter } from './router'

async function renderApp(path = '/') {
  const queryClient = new QueryClient()
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findByText('DCash')
  return router
}

test('renders the app shell with all nav sections', async () => {
  await renderApp()
  for (const label of ['Transactions', 'Accounts', 'Budgets', 'Recurring', 'Settings']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
  // Dashboard appears in the nav and as the active page title.
  expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(2)
})

test('routes render their placeholder views', async () => {
  await renderApp('/accounts')
  expect(await screen.findByText(/Your accounts in EUR, USD and RUB/)).toBeInTheDocument()
})

test('language toggle switches the UI to Russian and back', async () => {
  await renderApp()
  await userEvent.click(screen.getByText('Русский'))
  expect(await screen.findByText('Операции')).toBeInTheDocument()
  await userEvent.click(screen.getByText('English'))
  expect(await screen.findByText('Transactions')).toBeInTheDocument()
})

test('theme toggle flips the data-theme attribute', async () => {
  await renderApp()
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  await userEvent.click(screen.getByText('Dark mode'))
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  await userEvent.click(screen.getByText('Light mode'))
  expect(document.documentElement.getAttribute('data-theme')).toBe('light')
})
