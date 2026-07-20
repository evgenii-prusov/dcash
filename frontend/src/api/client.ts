import type {
  AuthProviders,
  Household,
  HouseholdInvite,
  HouseholdMember,
  LoginPayload,
  SignupPayload,
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
}
