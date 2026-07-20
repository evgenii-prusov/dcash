import type { ReactNode } from 'react'

export type IconName =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'recurring'
  | 'settings'
  | 'plus'
  | 'moon'
  | 'sun'
  | 'globe'
  | 'check'
  | 'search'
  | 'trash'
  | 'x'
  | 'logout'
  | 'edit'
  | 'transfer'
  | 'chevron-left'
  | 'chevron-right'

const paths = (c: string): Record<IconName, ReactNode> => ({
  dashboard: (
    <>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill={c} />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" fill={c} opacity=".55" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" fill={c} opacity=".55" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" fill={c} />
    </>
  ),
  transactions: (
    <path
      d="M3 5h8m0 0L8.8 2.8M11 5 8.8 7.2M13 11H5m0 0 2.2-2.2M5 11l2.2 2.2"
      stroke={c}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  accounts: (
    <>
      <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke={c} strokeWidth="1.4" fill="none" />
      <path d="M1.5 6.2h13" stroke={c} strokeWidth="1.2" fill="none" />
      <circle cx="11.6" cy="10" r="1.4" fill={c} />
    </>
  ),
  budgets: (
    <>
      <circle cx="8" cy="8" r="5.5" stroke={c} strokeWidth="1.5" fill="none" />
      <path d="M8 8V2.5A5.5 5.5 0 0 1 13.5 8H8z" fill={c} />
    </>
  ),
  recurring: (
    <path
      d="M13 8a5 5 0 1 1-1.4-3.5M13 2.5V5h-2.5"
      stroke={c}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  settings: (
    <>
      <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="4.5" r="1.7" fill={c} />
      <circle cx="5" cy="8" r="1.7" fill={c} />
      <circle cx="11" cy="11.5" r="1.7" fill={c} />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none" />,
  moon: <path d="M13 9A7 7 0 0 1 5 3a7 7 0 1 0 8 6z" fill={c} />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.5" fill={c} />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" stroke={c} strokeWidth="1.4" fill="none" />
      <ellipse cx="8" cy="8" rx="2.7" ry="6" stroke={c} strokeWidth="1.2" fill="none" />
      <path d="M2 8h12" stroke={c} strokeWidth="1.2" fill="none" />
    </>
  ),
  check: <path d="M3 8l3.5 3.5L13 5" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" stroke={c} strokeWidth="1.5" fill="none" />
      <path d="M10.5 10.5L14 14" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  trash: (
    <path
      d="M3 4h10M6.5 4V2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V4M4.5 4l.6 9a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-9"
      stroke={c}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  x: (
    <path d="M4 4l8 8M12 4l-8 8" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
  ),
  logout: (
    <path
      d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M6 8h7"
      stroke={c}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  edit: (
    <path
      d="M11 2.5l2.5 2.5-7 7H4V9.5l7-7z"
      stroke={c}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  transfer: (
    <path
      d="M3 5h8m0 0L8.8 2.8M11 5 8.8 7.2M13 11H5m0 0 2.2-2.2M5 11l2.2 2.2"
      stroke={c}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  'chevron-left': (
    <path d="M10 3L6 8l4 5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
  'chevron-right': (
    <path d="M6 3l4 5-4 5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ),
})

export function Ic({ n, s = 15, c = 'currentColor' }: { n: IconName; s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      {paths(c)[n]}
    </svg>
  )
}
