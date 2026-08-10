import { describe, expect, test } from 'vitest'
import { constantTimeEqual, requireAdmin } from './auth'

describe('admin authentication', () => {
  test('accepts only the configured token', () => {
    expect(() =>
      requireAdmin('secret', { ADMIN_TOKEN: 'secret' }),
    ).not.toThrow()
    expect(() => requireAdmin('wrong', { ADMIN_TOKEN: 'secret' })).toThrow(
      'Accès administrateur refusé',
    )
    expect(() => requireAdmin('', {})).toThrow('Accès administrateur refusé')
  })

  test('compares unequal lengths without accepting a matching prefix', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true)
    expect(constantTimeEqual('secret', 'secret-longer')).toBe(false)
  })
})
