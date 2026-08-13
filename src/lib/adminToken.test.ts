import { describe, expect, it } from 'vitest'
import { ADMIN_TOKEN_STORAGE_KEY, adminTokenState } from './adminToken'

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

describe('ADMIN_TOKEN_STORAGE_KEY', () => {
  it('names a session-only slot, so a shared laptop keeps nothing', () => {
    expect(ADMIN_TOKEN_STORAGE_KEY).toBe('table-des-recettes-admin-token')
  })
})
