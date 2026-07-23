import type {
  Account,
  AccountCreate,
  AccountPatch,
  AuthProviders,
  CategoryGroup,
  Category,
  Household,
  HouseholdInvite,
  HouseholdMember,
  LedgerEntry,
  LoginPayload,
  PayeeSuggestion,
  SignupPayload,
  Transaction,
  TransactionCreate,
  TransactionPatch,
  TransactionSplitCreate,
  TransactionSplitPayload,
  Transfer,
  TransferCreate,
  TransferPatch,
  User,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  authMe: () => request<User>('/api/auth/me'),
  signup: (payload: SignupPayload) =>
    request<User>('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: LoginPayload) =>
    request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  authProviders: () => request<AuthProviders>('/api/auth/providers'),

  getHousehold: () => request<Household>('/api/household/'),
  listMembers: () => request<HouseholdMember[]>('/api/household/members'),
  removeMember: (userId: number) =>
    request<void>(`/api/household/members/${userId}`, { method: 'DELETE' }),
  listInvites: () => request<HouseholdInvite[]>('/api/household/invites'),
  createInvite: () =>
    request<HouseholdInvite>('/api/household/invites', { method: 'POST', body: '{}' }),
  revokeInvite: (id: number) =>
    request<void>(`/api/household/invites/${id}`, { method: 'DELETE' }),

  // E3: Accounts
  listAccounts: () => request<Account[]>('/api/accounts/'),
  createAccount: (data: AccountCreate) =>
    request<Account>('/api/accounts/', { method: 'POST', body: JSON.stringify(data) }),
  patchAccount: (id: number, data: AccountPatch) =>
    request<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // E3: Categories
  listCategories: () => request<CategoryGroup[]>('/api/categories/'),
  createGroup: (data: { name: string; kind: 'expense' | 'income'; sort_order?: number }) =>
    request<CategoryGroup>('/api/categories/groups', { method: 'POST', body: JSON.stringify(data) }),
  createCategory: (data: { group_id: number; name: string; sort_order?: number }) =>
    request<Category>('/api/categories/', { method: 'POST', body: JSON.stringify(data) }),
  patchCategory: (id: number, data: { name?: string; archived?: boolean; sort_order?: number; group_id?: number }) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // E3: Transactions
  createTransaction: (data: TransactionCreate) =>
    request<Transaction>('/api/transactions/', { method: 'POST', body: JSON.stringify(data) }),
  patchTransaction: (id: number, data: TransactionPatch) =>
    request<Transaction>(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransaction: (id: number) =>
    request<void>(`/api/transactions/${id}`, { method: 'DELETE' }),

  // Transaction splits + omnibox quick-add
  splitTransaction: (id: number, payload: TransactionSplitPayload) =>
    request<Transaction[]>(`/api/transactions/${id}/split`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createSplitTransaction: (payload: TransactionSplitCreate) =>
    request<Transaction[]>('/api/transactions/splits', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteSplitGroup: (groupId: number) =>
    request<void>(`/api/transactions/splits/${groupId}`, { method: 'DELETE' }),
  listPayees: () => request<PayeeSuggestion[]>('/api/transactions/payees'),

  // E3: Transfers
  createTransfer: (data: TransferCreate) =>
    request<Transfer>('/api/transfers/', { method: 'POST', body: JSON.stringify(data) }),
  patchTransfer: (id: number, data: TransferPatch) =>
    request<Transfer>(`/api/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransfer: (id: number) =>
    request<void>(`/api/transfers/${id}`, { method: 'DELETE' }),

  // E3: Ledger
  getLedger: (params: { month: string; account_id?: number; category_id?: number; q?: string }) => {
    const qs = new URLSearchParams({ month: params.month })
    if (params.account_id != null) qs.set('account_id', String(params.account_id))
    if (params.category_id != null) qs.set('category_id', String(params.category_id))
    if (params.q) qs.set('q', params.q)
    return request<LedgerEntry[]>(`/api/ledger/?${qs}`)
  },

  // E4: Rates
  getRates: (date?: string) => {
    const qs = date ? `?date=${date}` : ''
    return request<import('./types').Rate[]>(`/api/rates/${qs}`)
  },
  overrideRate: (date: string, currency: string, rate_to_eur: string) =>
    request<import('./types').Rate>(`/api/rates/${date}/${currency}`, {
      method: 'PUT',
      body: JSON.stringify({ rate_to_eur }),
    }),
  refreshRates: () => request<import('./types').Rate[]>('/api/rates/refresh', { method: 'POST' }),

  // E5: Reports
  getReportSummary: (month: string) =>
    request<import('./types').ReportSummary>(`/api/reports/summary?month=${month}`),
  getReportCategories: (month: string, kind: 'expense' | 'income' = 'expense') =>
    request<import('./types').ReportCategories>(`/api/reports/categories?month=${month}&kind=${kind}`),
  getReportNetWorth: (from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    return request<import('./types').ReportNetWorth>(`/api/reports/net-worth?${qs}`)
  },
}
