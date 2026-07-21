import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from './client'
import type {
  AccountCreate,
  AccountPatch,
  LoginPayload,
  SignupPayload,
  TransactionCreate,
  TransactionPatch,
  TransactionSplitCreate,
  TransactionSplitPayload,
  TransferCreate,
  TransferPatch,
} from './types'

/** Session query, shared by useCurrentUser and the router's auth guards. */
export const currentUserQueryOptions = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: api.authMe,
  retry: false,
  staleTime: Infinity,
})

export function useCurrentUser() {
  return useQuery(currentUserQueryOptions)
}

export function useSignup() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (payload: SignupPayload) => api.signup(payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      navigate({ to: '/' })
    },
  })
}

export function useLogin() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (payload: LoginPayload) => api.login(payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      navigate({ to: '/' })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      qc.clear()
      navigate({ to: '/welcome' })
    },
  })
}

/** Which OAuth providers are configured server-side. Public — used on /welcome
 * before a session exists, so it must not depend on auth state. */
export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: api.authProviders,
    retry: false,
    staleTime: Infinity,
  })
}

export function useHousehold() {
  return useQuery({ queryKey: ['household'], queryFn: api.getHousehold })
}

export function useHouseholdMembers() {
  return useQuery({ queryKey: ['household', 'members'], queryFn: api.listMembers })
}

export function useHouseholdInvites() {
  return useQuery({ queryKey: ['household', 'invites'], queryFn: api.listInvites })
}

export function useCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.createInvite(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household', 'invites'] }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.revokeInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household', 'invites'] }),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => api.removeMember(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household', 'members'] }),
  })
}

// ---------------------------------------------------------------------------
// E3: Accounts
// ---------------------------------------------------------------------------

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountCreate) => api.createAccount(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function usePatchAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountPatch }) => api.patchAccount(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

// ---------------------------------------------------------------------------
// E3: Categories
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: api.listCategories })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { group_id: number; name: string; sort_order?: number }) =>
      api.createCategory(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
}

// ---------------------------------------------------------------------------
// E3: Transactions
// ---------------------------------------------------------------------------

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TransactionCreate) => api.createTransaction(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function usePatchTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: TransactionPatch }) =>
      api.patchTransaction(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function useDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteTransaction(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Transaction splits + omnibox quick-add
// ---------------------------------------------------------------------------

export function useSplitTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TransactionSplitPayload }) =>
      api.splitTransaction(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payees'] })
    },
  })
}

export function useCreateSplitTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TransactionSplitCreate) => api.createSplitTransaction(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payees'] })
    },
  })
}

export function useDeleteSplitGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (groupId: number) => api.deleteSplitGroup(groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['payees'] })
    },
  })
}

/** Whole-list merchant history for autocomplete; filtered in memory by callers. */
export function usePayees() {
  return useQuery({
    queryKey: ['payees'],
    queryFn: api.listPayees,
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// E3: Transfers
// ---------------------------------------------------------------------------

export function useCreateTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TransferCreate) => api.createTransfer(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function usePatchTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: TransferPatch }) =>
      api.patchTransfer(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

export function useDeleteTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteTransfer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

// ---------------------------------------------------------------------------
// E3: Ledger
// ---------------------------------------------------------------------------

export function useLedger(params: { month: string; account_id?: number; category_id?: number; q?: string }) {
  return useQuery({
    queryKey: ['ledger', params],
    queryFn: () => api.getLedger(params),
    enabled: !!params.month,
  })
}

// ---------------------------------------------------------------------------
// E4: Rates
// ---------------------------------------------------------------------------

export function useRates(date?: string) {
  return useQuery({
    queryKey: ['rates', date],
    queryFn: () => api.getRates(date),
  })
}

export function useOverrideRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, currency, rate_to_eur }: { date: string; currency: string; rate_to_eur: string }) =>
      api.overrideRate(date, currency, rate_to_eur),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
    },
  })
}

export function useRefreshRates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.refreshRates(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

// ---------------------------------------------------------------------------
// E5: Reports
// ---------------------------------------------------------------------------

export function useReportSummary(month: string) {
  return useQuery({
    queryKey: ['reports', 'summary', month],
    queryFn: () => api.getReportSummary(month),
    enabled: !!month,
  })
}

export function useReportCategories(month: string, kind: 'expense' | 'income' = 'expense') {
  return useQuery({
    queryKey: ['reports', 'categories', month, kind],
    queryFn: () => api.getReportCategories(month, kind),
    enabled: !!month,
  })
}

export function useReportNetWorth(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'net-worth', from, to],
    queryFn: () => api.getReportNetWorth(from, to),
  })
}
