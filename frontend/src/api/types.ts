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

// ---------------------------------------------------------------------------
// E3: Core Ledger
// ---------------------------------------------------------------------------

export type AccountType = 'savings' | 'cash' | 'card'

export interface Account {
  id: number
  name: string
  type: AccountType
  currency: string
  opening_balance_minor: number
  balance_minor: number
  balance_eur_minor: number
  archived: boolean
  sort_order: number
}

export interface AccountCreate {
  name: string
  type: AccountType
  currency: string
  opening_balance_minor?: number
  sort_order?: number
}

export interface AccountPatch {
  name?: string
  opening_balance_minor?: number
  archived?: boolean
  sort_order?: number
}

export interface Category {
  id: number
  name: string
  archived: boolean
  sort_order: number
}

export interface CategoryGroup {
  id: number
  name: string
  kind: 'expense' | 'income'
  sort_order: number
  categories: Category[]
}

export interface TransactionCreate {
  account_id: number
  category_id: number
  amount_minor: number
  date: string  // YYYY-MM-DD
  payee?: string | null
  note?: string | null
}

export interface TransactionPatch {
  category_id?: number
  amount_minor?: number
  date?: string
  payee?: string | null
  note?: string | null
}

export interface Transaction {
  id: number
  account_id: number
  account_name: string
  category_id: number
  category_name: string
  group_name: string
  kind: 'expense' | 'income'
  amount_minor: number
  amount_eur_minor: number
  currency: string
  date: string
  payee: string | null
  note: string | null
  created_at: string
}

export interface TransferCreate {
  from_account_id: number
  to_account_id: number
  from_amount_minor: number
  to_amount_minor: number
  date: string
  note?: string | null
}

export interface TransferPatch {
  from_amount_minor?: number
  to_amount_minor?: number
  date?: string
  note?: string | null
}

export interface Transfer {
  id: number
  from_account_id: number
  from_account_name: string
  to_account_id: number
  to_account_name: string
  from_amount_minor: number
  to_amount_minor: number
  from_amount_eur_minor: number
  to_amount_eur_minor: number
  from_currency: string
  to_currency: string
  date: string
  note: string | null
  created_at: string
}

export type LedgerEntry =
  | ({ type: 'transaction' } & Transaction)
  | ({ type: 'transfer' } & Transfer)

// ---------------------------------------------------------------------------
// E4: FX Rates
// ---------------------------------------------------------------------------

export interface Rate {
  date: string
  currency: string
  rate_to_eur: string
  source: 'auto' | 'manual'
}
