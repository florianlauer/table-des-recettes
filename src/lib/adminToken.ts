import { useCallback, useEffect, useState } from 'react'

export const ADMIN_TOKEN_STORAGE_KEY = 'table-des-recettes-admin-token'

export type AdminTokenState = 'resolving' | 'absent' | 'present'

/**
 * Three states, because there are three. The token lives in `sessionStorage`, which neither the
 * server render nor the first client render can read: taking that first render for "no token" is
 * what made the sub-pages open on « Jeton absent » for an operator who had one, and what made
 * `/admin` flash its own empty lines before its scans arrived.
 */
export function adminTokenState(token: string | null): AdminTokenState {
  if (token === null) return 'resolving'
  return token === '' ? 'absent' : 'present'
}

export function useAdminToken(): {
  /** `null` while unresolved — pass `token ?? ''` to anything that only needs the value. */
  token: string | null
  save: (value: string) => void
} {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    setToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

  const save = useCallback((value: string) => {
    setToken(value)
    if (value) sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value)
    else sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  }, [])

  return { token, save }
}
