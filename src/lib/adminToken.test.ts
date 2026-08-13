import { describe, expect, it } from 'vitest'
import {
  ADMIN_TOKEN_STORAGE_KEY,
  adminTokenState,
  affectsAdminToken,
  readAdminToken,
  resolveAdminToken,
  writeAdminToken,
} from './adminToken'
import type { TokenSlot } from './adminToken'

function fakeSlot(entries: Record<string, string> = {}): TokenSlot & {
  entries: Map<string, string>
} {
  const map = new Map(Object.entries(entries))
  return {
    entries: map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

describe('adminTokenState', () => {
  it('tells an unread storage apart from an empty one', () => {
    expect(adminTokenState(null)).toBe('resolving')
    expect(adminTokenState('')).toBe('absent')
  })

  it('reports a stored token as present', () => {
    expect(adminTokenState('s3cret')).toBe('present')
  })

  it('treats whitespace as a token, since the server is what judges it', () => {
    expect(adminTokenState(' ')).toBe('present')
  })
})

describe('readAdminToken', () => {
  it('reads back what was stored', () => {
    expect(
      readAdminToken(fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 's3cret' })),
    ).toBe('s3cret')
  })

  it('reports an empty slot as absent rather than null', () => {
    expect(readAdminToken(fakeSlot())).toBe('')
  })
})

describe('writeAdminToken', () => {
  it('reads back what it wrote', () => {
    const slot = fakeSlot()
    writeAdminToken(slot, 's3cret')
    expect(readAdminToken(slot)).toBe('s3cret')
  })

  it('clears the slot instead of storing an empty token', () => {
    const slot = fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 's3cret' })
    writeAdminToken(slot, '')
    expect(slot.entries.has(ADMIN_TOKEN_STORAGE_KEY)).toBe(false)
  })
})

describe('resolveAdminToken', () => {
  it('keeps reading the durable slot once the token lives there', () => {
    const kept = fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 's3cret' })
    const legacy = fakeSlot()
    expect(resolveAdminToken({ kept, legacy })).toBe('s3cret')
  })

  it('promotes the token a session-only slot still holds, so no retype is needed', () => {
    const kept = fakeSlot()
    const legacy = fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 's3cret' })

    expect(resolveAdminToken({ kept, legacy })).toBe('s3cret')
    expect(readAdminToken(kept)).toBe('s3cret')
    // The promoted copy is a secret left in a slot nothing reads any more.
    expect(legacy.entries.has(ADMIN_TOKEN_STORAGE_KEY)).toBe(false)
  })

  it('leaves the durable token alone when the old slot disagrees', () => {
    const kept = fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 'current' })
    const legacy = fakeSlot({ [ADMIN_TOKEN_STORAGE_KEY]: 'stale' })

    expect(resolveAdminToken({ kept, legacy })).toBe('current')
    expect(readAdminToken(kept)).toBe('current')
  })

  it('resolves to absent, not null, when neither slot holds one', () => {
    expect(resolveAdminToken({ kept: fakeSlot(), legacy: fakeSlot() })).toBe('')
  })
})

describe('affectsAdminToken', () => {
  it('answers to its own key', () => {
    expect(affectsAdminToken(ADMIN_TOKEN_STORAGE_KEY)).toBe(true)
  })

  it('ignores a neighbour key, so routing state never re-reads the token', () => {
    expect(affectsAdminToken('tsr-scroll-restoration-v1_3')).toBe(false)
  })

  it('treats a keyless event as a clear, which wipes this slot too', () => {
    expect(affectsAdminToken(null)).toBe(true)
  })
})

describe('ADMIN_TOKEN_STORAGE_KEY', () => {
  it('names one slot, so every admin screen reads the same token', () => {
    expect(ADMIN_TOKEN_STORAGE_KEY).toBe('table-des-recettes-admin-token')
  })
})
