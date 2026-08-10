import { expect, test } from 'vitest'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'

test('uses a session-only storage key for the admin token', () => {
  expect(ADMIN_TOKEN_STORAGE_KEY).toBe('table-des-recettes-admin-token')
})
