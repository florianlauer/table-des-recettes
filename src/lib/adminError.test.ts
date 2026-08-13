import { describe, expect, it } from 'vitest'
import { adminErrorLine, adminErrorRetryable } from './adminError'

describe('adminErrorLine', () => {
  it('names the wrong token rather than the Convex function that reported it', () => {
    const error = new Error(
      '[CONVEX Q(admin:queueStatus)] [Request ID: 1baacee] Uncaught ConvexError: Accès administrateur refusé',
    )
    expect(adminErrorLine(error)).toBe(
      'Jeton refusé. Vérifie le jeton administrateur.',
    )
  })

  it('never returns the raw server message', () => {
    const error = new Error(
      '[CONVEX Q(admin:listScans)] [Request ID: ebfd3c7] Server Error',
    )
    expect(adminErrorLine(error)).toBe('Le serveur n’a pas répondu.')
  })

  it('survives a thrown value that is not an Error', () => {
    expect(adminErrorLine(undefined)).toBe('Le serveur n’a pas répondu.')
    expect(adminErrorLine('Accès administrateur refusé')).toBe(
      'Jeton refusé. Vérifie le jeton administrateur.',
    )
  })
})

describe('adminErrorRetryable', () => {
  it('offers no retry on a refused token: retrying cannot fix it', () => {
    expect(
      adminErrorRetryable(
        new Error('Uncaught ConvexError: Accès administrateur refusé'),
      ),
    ).toBe(false)
  })

  it('offers a retry on anything else', () => {
    expect(adminErrorRetryable(new Error('Server Error'))).toBe(true)
  })
})
