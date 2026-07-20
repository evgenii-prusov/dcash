import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { useLanguage } from '../i18n'
import { useLogout } from '../api/hooks'
import { Ic, type IconName } from './Icon'

function NavLink({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: IconName
  label: string
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      className="nav"
      activeProps={{ className: 'nav on' }}
      activeOptions={{ exact: to === '/' }}
      onClick={onClick}
    >
      <Ic n={icon} s={14} /> {label}
    </Link>
  )
}

export function Sidebar({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const { t } = useTranslation()
  const { theme, toggle } = useTheme()
  const { lang, toggle: toggleLang } = useLanguage()
  const logout = useLogout()
  const close = () => onClose?.()

  return (
    <div
      className={[
        'flex w-[230px] min-w-[230px] flex-col overflow-y-auto border-r border-line bg-surface py-3.5',
        'fixed inset-y-0 left-0 z-40 transition-transform duration-200',
        'md:relative md:translate-x-0 md:transition-none',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}
    >
      <div className="flex items-center gap-[7px] px-[18px] pt-1 pb-[18px] font-serif text-[17px] font-semibold tracking-[-0.3px] text-accent">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="5" fill="var(--accent)" />
          <rect x="4" y="5.5" width="12" height="9.5" rx="1.8" stroke="#fff" strokeWidth="1.5" />
          <circle cx="12.8" cy="10.2" r="1.3" fill="#fff" />
        </svg>
        {t('app.name')}
      </div>

      <NavLink to="/" icon="dashboard" label={t('nav.dashboard')} onClick={close} />
      <NavLink to="/transactions" icon="transactions" label={t('nav.transactions')} onClick={close} />
      <NavLink to="/accounts" icon="accounts" label={t('nav.accounts')} onClick={close} />
      <NavLink to="/budgets" icon="budgets" label={t('nav.budgets')} onClick={close} />
      <NavLink to="/recurring" icon="recurring" label={t('nav.recurring')} onClick={close} />

      <hr className="s-divider" />
      <NavLink to="/settings" icon="settings" label={t('nav.settings')} onClick={close} />

      <div className="flex-1" />
      <hr className="s-divider" />
      <button className="nav" onClick={() => logout.mutate()}>
        <Ic n="logout" s={14} />
        {t('sidebar.logout')}
      </button>
      <button className="nav" onClick={toggle}>
        <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={14} />
        {theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
      </button>
      {/* Language names stay in their own language, so they live outside the catalogs. */}
      <button className="nav" onClick={toggleLang}>
        <Ic n="globe" s={14} />
        {lang === 'en' ? 'Русский' : 'English'}
      </button>
    </div>
  )
}
