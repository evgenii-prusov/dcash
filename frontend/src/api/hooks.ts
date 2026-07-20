import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from './client'
import type { LoginPayload, SignupPayload } from './types'

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
