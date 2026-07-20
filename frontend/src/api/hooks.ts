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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function usePatchAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountPatch }) => api.patchAccount(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

// ---------------------------------------------------------------------------
// E3: Categories
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: api.listCategories })
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
    },
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
