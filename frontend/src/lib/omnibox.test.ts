import { describe, expect, test } from 'vitest'
import { parseOmnibox, type OmniboxContext } from './omnibox'
import type { Account, CategoryGroup } from '../api/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function account(partial: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    type: 'cash',
    currency: 'EUR',
    opening_balance_minor: 0,
    balance_minor: 0,
    balance_eur_minor: 0,
    archived: false,
    sort_order: 0,
    ...partial,
  }
}

// An archived account sorts first here on purpose, to prove the default
// falls back to the first *non-archived* one rather than just `accounts[0]`.
const accounts: Account[] = [
  account({ id: 9, name: 'Old Savings', archived: true, type: 'savings' }),
  account({ id: 1, name: 'Cash' }),
  account({ id: 2, name: 'Main Card', type: 'card' }),
]

const groups: CategoryGroup[] = [
  {
    id: 1,
    name: 'Everyday',
    kind: 'expense',
    sort_order: 0,
    categories: [
      { id: 10, name: 'Groceries', archived: false, sort_order: 0 },
      { id: 11, name: 'Public transport', archived: false, sort_order: 1 },
    ],
  },
  {
    id: 2,
    name: 'Personal',
    kind: 'expense',
    sort_order: 1,
    categories: [
      { id: 12, name: 'Self-care', archived: false, sort_order: 0 },
      { id: 13, name: 'Home', archived: false, sort_order: 1 },
    ],
  },
  {
    id: 3,
    name: 'Income',
    kind: 'income',
    sort_order: 2,
    categories: [{ id: 14, name: 'Salary', archived: false, sort_order: 0 }],
  },
]

const ctx: OmniboxContext = { accounts, groups, today: '2026-07-21' }

function parse(input: string) {
  return parseOmnibox(input, ctx)
}

// ---------------------------------------------------------------------------
// Each sigil alone
// ---------------------------------------------------------------------------

describe('each sigil alone', () => {
  test('amount alone', () => {
    const p = parse('!60')
    expect(p.amountMinor).toBe(6000)
    expect(p.lines).toEqual([{ category: null, categoryQuery: null, amountMinor: 6000 }])
    expect(p.problems).toContain('problems.categoryMissing')
  })

  test('account alone, matched', () => {
    const p = parse('#cash')
    expect(p.account).toEqual({ query: 'cash', resolved: accounts[1] })
    expect(p.problems).not.toContain('problems.accountNotFound')
  })

  test('category alone, matched', () => {
    const p = parse('@groceries')
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0].category?.name).toBe('Groceries')
    expect(p.lines[0].categoryQuery).toBe('groceries')
    expect(p.lines[0].amountMinor).toBeNull()
    expect(p.problems).toContain('problems.amountMissing')
  })

  test('bare date alone', () => {
    const p = parse('21.07')
    expect(p.date).toBe('2026-07-21')
    expect(p.payee).toBeNull()
  })

  test('note alone', () => {
    const p = parse('// just a note')
    expect(p.note).toBe('just a note')
    expect(p.payee).toBeNull()
  })

  test('merchant alone (no sigils at all)', () => {
    const p = parse('LIDL')
    expect(p.payee).toBe('LIDL')
    expect(p.amountMinor).toBeNull()
    expect(p.date).toBe('2026-07-21')
  })
})

// ---------------------------------------------------------------------------
// All combined
// ---------------------------------------------------------------------------

describe('sigils combined', () => {
  test('the canonical single-category entry', () => {
    const p = parse('EDEKA !60 #cash @groceries')
    expect(p.payee).toBe('EDEKA')
    expect(p.amountMinor).toBe(6000)
    expect(p.account.resolved?.name).toBe('Cash')
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0]).toMatchObject({ categoryQuery: 'groceries', amountMinor: 6000 })
    expect(p.lines[0].category?.name).toBe('Groceries')
    expect(p.date).toBe('2026-07-21') // no date token -> defaults to today
    expect(p.problems).toEqual([])
  })

  test('merchant + account + category + note + explicit date, all present', () => {
    const p = parse('REWE #cash @groceries !40 @home !20 21.07 // weekly run')
    expect(p.payee).toBe('REWE')
    expect(p.account.resolved?.name).toBe('Cash')
    expect(p.date).toBe('2026-07-21')
    expect(p.note).toBe('weekly run')
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0]).toMatchObject({ categoryQuery: 'groceries', amountMinor: 4000 })
    expect(p.lines[1]).toMatchObject({ categoryQuery: 'home', amountMinor: 2000 })
    expect(p.amountMinor).toBe(6000)
    expect(p.problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Multi-word names
// ---------------------------------------------------------------------------

describe('multi-word sigil runs', () => {
  test('multi-word category name', () => {
    const p = parse('!5 #cash @Public transport')
    expect(p.lines[0].categoryQuery).toBe('Public transport')
    expect(p.lines[0].category?.name).toBe('Public transport')
  })

  test('multi-word account name is matched the same way', () => {
    const localAccounts = [...accounts, account({ id: 20, name: 'Joint account' })]
    const p = parseOmnibox('!5 #Joint account @groceries', { ...ctx, accounts: localAccounts })
    expect(p.account.query).toBe('Joint account')
    expect(p.account.resolved?.name).toBe('Joint account')
  })
})

// ---------------------------------------------------------------------------
// Decimal separators — the real-money bug this parser exists to avoid
// ---------------------------------------------------------------------------

describe('decimal separators', () => {
  test('dot separator', () => {
    expect(parse('!60.50').amountMinor).toBe(6050)
  })

  test('comma separator normalizes to the same value as a dot', () => {
    expect(parse('!60,50').amountMinor).toBe(6050)
  })

  test('regression: parseFloat("12,40") alone would wrongly yield 12 — must yield 1240', () => {
    // Sanity-check the known JS footgun this guards against.
    expect(Math.round(parseFloat('12,40') * 100)).toBe(1200)
    // The parser must not reproduce it.
    const p = parse('LIDL !12,40 #cash @groceries 19.07')
    expect(p.amountMinor).toBe(1240)
    expect(p.date).toBe('2026-07-19')
  })

  test('whole-euro amount with no decimal part', () => {
    expect(parse('!60').amountMinor).toBe(6000)
  })
})

// ---------------------------------------------------------------------------
// Dates — every form, EN and RU
// ---------------------------------------------------------------------------

describe('date forms', () => {
  test('today, EN', () => {
    expect(parse('!1 @groceries today').date).toBe('2026-07-21')
  })

  test('today, RU', () => {
    expect(parse('!1 @groceries сегодня').date).toBe('2026-07-21')
  })

  test('yesterday, EN', () => {
    expect(parse('!1 @groceries yesterday').date).toBe('2026-07-20')
  })

  test('yesterday, RU', () => {
    expect(parse('!1 @groceries вчера').date).toBe('2026-07-20')
  })

  test('dotted DD.MM, no year -> current year', () => {
    expect(parse('!1 @groceries 5.03').date).toBe('2026-03-05')
  })

  test('dotted DD.MM.YY, 2-digit year', () => {
    expect(parse('!1 @groceries 21.07.26').date).toBe('2026-07-21')
  })

  test('dotted DD.MM.YYYY, 4-digit year', () => {
    expect(parse('!1 @groceries 21.07.2027').date).toBe('2027-07-21')
  })

  test('slash DD/MM', () => {
    expect(parse('!1 @groceries 21/07').date).toBe('2026-07-21')
  })

  test('slash DD/MM/YYYY', () => {
    expect(parse('!1 @groceries 5/03/2025').date).toBe('2025-03-05')
  })

  test('day + EN month abbreviation', () => {
    expect(parse('!1 @groceries 21 jul').date).toBe('2026-07-21')
  })

  test('day + EN month full name', () => {
    expect(parse('!1 @groceries 21 july').date).toBe('2026-07-21')
  })

  test('day + RU month word (июля), disambiguated from March', () => {
    expect(parse('!1 @groceries 21 июля').date).toBe('2026-07-21')
  })

  test('day + RU month word (марта = March), not swallowed by the "May" prefix', () => {
    expect(parse('!1 @groceries 5 марта').date).toBe('2026-03-05')
  })

  test('day + RU month word (мая = May), disambiguated from March', () => {
    expect(parse('!1 @groceries 5 мая').date).toBe('2026-05-05')
  })

  test('date token is lifted out from wherever it sits, not appended to a category name', () => {
    // "19.07" would otherwise be swallowed into the "groceries" category run.
    const p = parse('LIDL !12 #cash @groceries 19.07')
    expect(p.date).toBe('2026-07-19')
    expect(p.lines[0].categoryQuery).toBe('groceries')
  })
})

// ---------------------------------------------------------------------------
// Inline split — with and without a leading total, and the mismatch problem
// ---------------------------------------------------------------------------

describe('inline split', () => {
  test('without a leading total: each @category claims the !amount after it', () => {
    const p = parse('REWE #cash @groceries !38 @self-care !12.50 @home !9.50 yesterday // weekly shop')
    expect(p.date).toBe('2026-07-20')
    expect(p.note).toBe('weekly shop')
    expect(p.lines).toHaveLength(3)
    expect(p.lines.map((l) => ({ categoryQuery: l.categoryQuery, amountMinor: l.amountMinor }))).toEqual([
      { categoryQuery: 'groceries', amountMinor: 3800 },
      { categoryQuery: 'self-care', amountMinor: 1250 },
      { categoryQuery: 'home', amountMinor: 950 },
    ])
    expect(p.lines.map((l) => l.category?.name)).toEqual(['Groceries', 'Self-care', 'Home'])
    expect(p.amountMinor).toBe(6000)
    expect(p.problems).toEqual([])
  })

  test('with a leading total that matches the sum of the lines', () => {
    const p = parse('EDEKA !60 #cash @groceries !40 @home !20')
    expect(p.amountMinor).toBe(6000)
    expect(p.lines.map((l) => l.amountMinor)).toEqual([4000, 2000])
    expect(p.problems).toEqual([])
  })

  test('with a leading total that does NOT match the sum -> blocking problem, no silent fix', () => {
    const p = parse('EDEKA !60 #cash @groceries !40 @home !15')
    expect(p.problems).toContain('problems.totalMismatch')
    // The stated total is preserved verbatim rather than silently replaced by the sum.
    expect(p.amountMinor).toBe(6000)
    expect(p.lines.map((l) => l.amountMinor)).toEqual([4000, 1500])
  })

  test('a single-category entry uses the leading total as that line\'s amount (not a split)', () => {
    const p = parse('!60 #cash @groceries')
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0].amountMinor).toBe(6000)
  })
})

// ---------------------------------------------------------------------------
// Unresolved vs. absent — the distinction that must never be blurred
// ---------------------------------------------------------------------------

describe('unresolved vs. absent account/category', () => {
  test('absent account falls back to the default (first non-archived), no problem', () => {
    const p = parse('!10 @groceries')
    expect(p.account.query).toBeNull()
    expect(p.account.resolved?.name).toBe('Cash') // not the archived "Old Savings" that sorts first
    expect(p.problems).not.toContain('problems.accountNotFound')
  })

  test('present-but-unmatched account (typo) blocks — never falls back to the default', () => {
    const p = parse('!10 #cahs @groceries')
    expect(p.account.query).toBe('cahs')
    expect(p.account.resolved).toBeNull()
    expect(p.problems).toContain('problems.accountNotFound')
  })

  test('absent category blocks submission (no default category exists)', () => {
    const p = parse('!10 #cash')
    expect(p.lines[0].category).toBeNull()
    expect(p.lines[0].categoryQuery).toBeNull()
    expect(p.problems).toContain('problems.categoryMissing')
    expect(p.problems).not.toContain('problems.categoryNotFound')
  })

  test('present-but-unmatched category (typo) blocks with a distinct problem code', () => {
    const p = parse('!10 #cash @groceriess')
    expect(p.lines[0].category).toBeNull()
    expect(p.lines[0].categoryQuery).toBe('groceriess')
    expect(p.problems).toContain('problems.categoryNotFound')
    expect(p.problems).not.toContain('problems.categoryMissing')
  })

  test('category name matching is case-insensitive', () => {
    const p = parse('!10 @GROCERIES')
    expect(p.lines[0].category?.name).toBe('Groceries')
  })

  test('both account and category unresolved at once report both problems', () => {
    const p = parse('!10 #cahs @groceriess')
    expect(p.problems).toEqual(expect.arrayContaining(['problems.accountNotFound', 'problems.categoryNotFound']))
  })
})
