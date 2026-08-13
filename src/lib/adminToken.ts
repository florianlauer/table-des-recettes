import { useCallback, useEffect, useState } from 'react'

export const ADMIN_TOKEN_STORAGE_KEY = 'table-des-recettes-admin-token'

export type AdminTokenState = 'resolving' | 'absent' | 'present'

/** What we use of `Storage`, so the rules below can be read without a DOM. */
export type TokenSlot = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Three states, because there are three. The token lives in browser storage, which neither the
 * server render nor the first client render can read: taking that first render for "no token" is
 * what made the sub-pages open on « Jeton absent » for an operator who had one, and what made
 * `/admin` flash its own empty lines before its scans arrived.
 */
export function adminTokenState(token: string | null): AdminTokenState {
  if (token === null) return 'resolving'
  return token === '' ? 'absent' : 'present'
}

export function readAdminToken(slot: TokenSlot): string {
  return slot.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? ''
}

/**
 * Which `storage` events are about us. `clear()` reports no key at all, and it wipes this slot like
 * any other — reading that `null` as « not our key » is how a cleared storage would go unnoticed.
 */
export function affectsAdminToken(key: string | null): boolean {
  return key === null || key === ADMIN_TOKEN_STORAGE_KEY
}

/**
 * An emptied field clears the slot instead of storing `''`. Both read back as « absent », but only
 * one of them actually stops carrying the token around.
 */
export function writeAdminToken(slot: TokenSlot, value: string): void {
  if (value) slot.setItem(ADMIN_TOKEN_STORAGE_KEY, value)
  else slot.removeItem(ADMIN_TOKEN_STORAGE_KEY)
}

/**
 * What a mount reads, and the one place the two slots meet.
 *
 * The token used to live in the session-only slot, which is why it vanished with the tab. It is
 * kept for good now — but a tab that reloads onto this release still holds the old copy, so the
 * first mount promotes it rather than asking for a retype, and empties the slot nothing reads any
 * more. The `legacy` half is removable once every admin tab has been through here.
 */
export function resolveAdminToken({
  kept,
  legacy,
}: {
  kept: TokenSlot
  legacy: TokenSlot
}): string {
  const stored = readAdminToken(kept)
  if (stored) return stored

  const carried = readAdminToken(legacy)
  if (!carried) return ''
  writeAdminToken(kept, carried)
  writeAdminToken(legacy, '')
  return carried
}

export function useAdminToken(): {
  /** `null` while unresolved — pass `token ?? ''` to anything that only needs the value. */
  token: string | null
  save: (value: string) => void
} {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    setToken(resolveAdminToken({ kept: localStorage, legacy: sessionStorage }))
  }, [])

  // `localStorage` outlives the tab, so two admin screens can be open with different ideas of the
  // token. The one that was already open when the token got typed learns it here rather than on a
  // reload. The event never reaches the document that wrote it, so this cannot fight `save` below —
  // which is also why two `useAdminToken()` in the *same* document would drift apart. Today each
  // admin route mounts exactly one, and `admin_.` un-nests them so no two are ever mounted together.
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.storageArea !== localStorage) return
      if (!affectsAdminToken(event.key)) return
      setToken(readAdminToken(localStorage))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const save = useCallback((value: string) => {
    setToken(value)
    writeAdminToken(localStorage, value)
  }, [])

  return { token, save }
}
