import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuthProviders, useLogin, useSignup } from '../api/hooks'

// signup = create new household via DCASH_INVITE_CODE
// join   = join existing household via a join code
// login  = existing account
type Mode = 'signup' | 'join' | 'login'
type Provider = 'google' | 'github'

// Keep in sync with docs/auth.md §2.7.
const OAUTH_ERROR_CODES = [
  'invite_required',
  'invalid_invite',
  'no_verified_email',
  'state_mismatch',
  'provider_error',
] as const

type OauthErrorCode = (typeof OAUTH_ERROR_CODES)[number]

function isOauthErrorCode(code: string): code is OauthErrorCode {
  return (OAUTH_ERROR_CODES as readonly string[]).includes(code)
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[10px] font-bold uppercase tracking-[.09em] text-ink-3"
    >
      {children}
    </label>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.68 9c0-.593.102-1.17.284-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function OAuthButton({
  provider,
  label,
  icon,
  onClick,
}: {
  provider: Provider
  label: string
  icon: ReactNode
  onClick: (provider: Provider) => void
}) {
  return (
    <button
      type="button"
      className="btn btn-g w-full justify-center gap-2"
      onClick={() => onClick(provider)}
    >
      {icon}
      {label}
    </button>
  )
}

export function WelcomeView() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [oauthInviteError, setOauthInviteError] = useState(false)
  const signup = useSignup()
  const login = useLogin()
  const { data: providers } = useAuthProviders()

  const search = useSearch({ from: '/welcome' })
  const navigate = useNavigate()
  const [oauthBannerCode, setOauthBannerCode] = useState(search.oauth_error)

  useEffect(() => {
    if (search.oauth_error) {
      navigate({ to: '/welcome', search: {}, replace: true })
    }
    // Only ever run this once, on mount — it strips the param it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pending = signup.isPending || login.isPending
  const mutationError = mode !== 'login' ? signup.error : login.error

  const errorText = (err: Error) => {
    if (!(err instanceof ApiError)) return t('common.genericError')
    if (err.status === 401) return t('welcome.errors.invalidCredentials')
    if (err.status === 403) return t('welcome.errors.invalidInvite')
    if (err.status === 409) return t('welcome.errors.emailExists')
    return err.message
  }

  const oauthErrorText = (code: string): string => {
    if (isOauthErrorCode(code)) return t(`welcome.errors.oauth.${code}`)
    return t('common.genericError')
  }

  const displayError = oauthInviteError
    ? t('welcome.inviteRequiredForOauth')
    : mutationError
      ? errorText(mutationError)
      : oauthBannerCode
        ? oauthErrorText(oauthBannerCode)
        : null

  const switchMode = (next: Mode) => {
    setMode(next)
    setOauthInviteError(false)
    setOauthBannerCode(undefined)
    signup.reset()
    login.reset()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (pending) return
    setOauthInviteError(false)
    if (mode === 'login') login.mutate({ email, password })
    else signup.mutate({ email, password, invite_code: inviteCode })
  }

  const handleOAuthClick = (provider: Provider) => {
    if (mode !== 'login') {
      const trimmed = inviteCode.trim()
      if (!trimmed) {
        setOauthInviteError(true)
        return
      }
      setOauthInviteError(false)
      window.location.href = `/api/auth/oauth/${provider}/login?invite_code=${encodeURIComponent(trimmed)}`
      return
    }
    window.location.href = `/api/auth/oauth/${provider}/login`
  }

  const showOAuth = Boolean(providers?.google || providers?.github)
  const isSignupLike = mode !== 'login'

  const title =
    mode === 'signup'
      ? t('welcome.signupTitle')
      : mode === 'join'
        ? t('welcome.joinTitle')
        : t('welcome.loginTitle')

  const submitLabel =
    mode === 'login'
      ? login.isPending
        ? t('welcome.loggingIn')
        : t('welcome.logIn')
      : mode === 'join'
        ? signup.isPending
          ? t('welcome.joiningHousehold')
          : t('welcome.joinHousehold')
        : signup.isPending
          ? t('welcome.creatingAccount')
          : t('welcome.createAccount')

  return (
    <div className="flex h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-2 flex items-center justify-center gap-2 font-serif text-[22px] font-semibold tracking-[-0.4px] text-accent">
          <svg width="26" height="26" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="5" fill="var(--accent)" />
            <rect x="4" y="5.5" width="12" height="9.5" rx="1.8" stroke="#fff" strokeWidth="1.5" />
            <circle cx="12.8" cy="10.2" r="1.3" fill="#fff" />
          </svg>
          {t('app.name')}
        </div>
        <p className="mb-6 text-center text-[13px] leading-[1.6] text-ink-2">
          {t('welcome.tagline')}
        </p>

        <form className="card p-5" onSubmit={onSubmit}>
          <h2 className="mb-4 font-serif text-[16px] font-semibold">{title}</h2>

          <FieldLabel htmlFor="auth-email">{t('welcome.email')}</FieldLabel>
          <input
            id="auth-email"
            type="email"
            required
            autoComplete="email"
            className="input mb-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <FieldLabel htmlFor="auth-password">{t('welcome.password')}</FieldLabel>
          <input
            id="auth-password"
            type="password"
            required
            autoComplete={isSignupLike ? 'new-password' : 'current-password'}
            className="input mb-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {isSignupLike && (
            <>
              <FieldLabel htmlFor="auth-invite">
                {mode === 'join' ? t('welcome.joinCode') : t('welcome.inviteCode')}
              </FieldLabel>
              <input
                id="auth-invite"
                type="text"
                required
                autoComplete="off"
                className="input mb-3"
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value)
                  setOauthInviteError(false)
                }}
              />
            </>
          )}

          {displayError && (
            <div className="mb-3 rounded-md bg-warn-2 px-3 py-2 text-[12px] font-medium text-warn">
              {displayError}
            </div>
          )}

          <button type="submit" className="btn btn-p w-full justify-center" disabled={pending}>
            {submitLabel}
          </button>

          {showOAuth && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-medium uppercase tracking-[.08em] text-ink-3">
                  {t('welcome.or')}
                </span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <div className="flex flex-col gap-2">
                {providers?.google && (
                  <OAuthButton
                    provider="google"
                    label={t('welcome.continueWithGoogle')}
                    icon={<GoogleIcon />}
                    onClick={handleOAuthClick}
                  />
                )}
                {providers?.github && (
                  <OAuthButton
                    provider="github"
                    label={t('welcome.continueWithGithub')}
                    icon={<GithubIcon />}
                    onClick={handleOAuthClick}
                  />
                )}
              </div>
            </>
          )}
        </form>

        <p className="mt-4 text-center text-[12px] text-ink-3">
          {mode === 'login' ? (
            <>
              {t('welcome.needAccount')}{' '}
              <button
                type="button"
                className="font-semibold text-accent hover:underline"
                onClick={() => switchMode('signup')}
              >
                {t('welcome.signUp')}
              </button>
            </>
          ) : (
            <>
              {t('welcome.haveAccount')}{' '}
              <button
                type="button"
                className="font-semibold text-accent hover:underline"
                onClick={() => switchMode('login')}
              >
                {t('welcome.logIn')}
              </button>
            </>
          )}
        </p>
        {mode === 'signup' && (
          <p className="mt-2 text-center text-[12px] text-ink-3">
            {t('welcome.haveJoinCode')}{' '}
            <button
              type="button"
              className="font-semibold text-accent hover:underline"
              onClick={() => switchMode('join')}
            >
              {t('welcome.joinHousehold')}
            </button>
          </p>
        )}
        {mode === 'join' && (
          <p className="mt-2 text-center text-[12px] text-ink-3">
            <button
              type="button"
              className="font-semibold text-accent hover:underline"
              onClick={() => switchMode('signup')}
            >
              {t('welcome.createAccount')}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
