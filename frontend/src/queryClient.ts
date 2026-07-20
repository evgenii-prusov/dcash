import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'

export interface AuthRedirect {
  currentPath: () => string
  redirectToWelcome: () => void
}

/**
 * Global 401 handler: any unauthorized response outside /welcome kicks the
 * user back to the landing page. This covers session expiry mid-use — the
 * route guard only runs on navigation, so an expired session would otherwise
 * leave broken views on screen.
 */
export function handleAuthError(err: unknown, redirect: AuthRedirect): void {
  if (!(err instanceof ApiError) || err.status !== 401) return
  if (redirect.currentPath() === '/welcome') return
  redirect.redirectToWelcome()
}

export function createQueryClient(redirect: AuthRedirect): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
    queryCache: new QueryCache({ onError: (err) => handleAuthError(err, redirect) }),
    mutationCache: new MutationCache({ onError: (err) => handleAuthError(err, redirect) }),
  })
}
