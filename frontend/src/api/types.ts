export interface User {
  id: number
  email: string
}

export interface SignupPayload {
  email: string
  password: string
  invite_code: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface AuthProviders {
  google: boolean
  github: boolean
}

export interface Household {
  id: number
  name: string
}

export interface HouseholdMember {
  id: number
  email: string
  role: 'owner' | 'member'
  joined_at: string
}

export interface HouseholdInvite {
  id: number
  code: string
  expires_at: string
  used_at: string | null
}
