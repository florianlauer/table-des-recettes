import { describe, expect, test } from 'vitest'
import { dataView, readyData } from './dataView'
import { adminQueryArgs } from './useAdminQuery'

/**
 * The gate itself, asserted on values rather than read off the routes' source. What used to be
 * checked by scanning three route files for `'skip'` is checked here once, on the only code that
 * can produce it.
 */
describe('adminQueryArgs', () => {
  test('carries the token alongside the query’s own arguments', () => {
    expect(adminQueryArgs('secret', { scanId: 'scan-1' })).toEqual({
      scanId: 'scan-1',
      adminToken: 'secret',
    })
  })

  test('a token still being read out of storage skips like an absent one', () => {
    // Three token states, two behaviours: `null` is "not read yet", `''` is "none". Neither may go
    // out — an empty token earns an opaque « Server Error » the operator cannot act on.
    expect(adminQueryArgs(null, {})).toBe('skip')
    expect(adminQueryArgs('', {})).toBe('skip')
  })

  test('never lets a caller’s argument overwrite the token', () => {
    // The token is spread last on purpose: a query that happens to name an argument `adminToken`
    // would otherwise decide what it is authenticated with.
    expect(adminQueryArgs('secret', { adminToken: 'forged' })).toEqual({
      adminToken: 'secret',
    })
  })
})

/** The other half of the seam: what the section reads once the answer is in. */
describe('readyData', () => {
  test('yields the answer only when there is one', () => {
    const ready = dataView({
      tokenAbsent: false,
      loading: false,
      error: null,
      data: [1, 2],
    })
    expect(readyData(ready)).toEqual([1, 2])
    for (const view of [
      dataView({
        tokenAbsent: true,
        loading: false,
        error: null,
        data: [1, 2],
      }),
      dataView({
        tokenAbsent: false,
        loading: true,
        error: null,
        data: undefined,
      }),
      dataView({
        tokenAbsent: false,
        loading: false,
        error: new Error('non'),
        data: [1, 2],
      }),
    ])
      expect(readyData(view)).toBeNull()
  })
})
