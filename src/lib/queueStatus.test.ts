import { describe, expect, test } from 'vitest'
import { LEASE_MS } from '../shared/queueContract'
import { deriveQueueState, formatAge, isLeaseLive } from './queueStatus'

const idle = { pendingCount: 0, leaseStartedAt: null, nextAttemptAt: null }

describe('queue status', () => {
  test('expires a lease against the corrected clock', () => {
    expect(isLeaseLive({ leaseStartedAt: 1_000, now: 1_000 + LEASE_MS })).toBe(
      false,
    )
    expect(isLeaseLive({ leaseStartedAt: 1_001, now: 1_000 + LEASE_MS })).toBe(
      true,
    )
  })

  test('does not call a queue stopped while its retry is scheduled', () => {
    expect(
      deriveQueueState({
        facts: { ...idle, pendingCount: 1, nextAttemptAt: 20_000 },
        now: 10_000,
      }).stopped,
    ).toBe(false)
  })

  test('calls a queue stopped when the retry deadline passes', () => {
    expect(
      deriveQueueState({
        facts: { ...idle, pendingCount: 1, nextAttemptAt: 20_000 },
        now: 20_000,
      }).stopped,
    ).toBe(true)
  })

  test('selects truthful launch, relaunch, empty, and waiting labels', () => {
    const now = 200_000
    expect(
      deriveQueueState({ facts: { ...idle, pendingCount: 1 }, now }).button,
    ).toEqual({ label: 'Démarrer l’extraction', disabled: false })
    expect(
      deriveQueueState({ facts: { ...idle, leaseStartedAt: 1 }, now }).button,
    ).toEqual({ label: 'Relancer la file', disabled: false })
    expect(deriveQueueState({ facts: idle, now }).button).toEqual({
      label: 'Rien à extraire',
      disabled: true,
    })
    expect(
      deriveQueueState({
        facts: { ...idle, pendingCount: 1, nextAttemptAt: 260_000 },
        now,
      }).button,
    ).toEqual({ label: 'Reprise dans 1 min', disabled: true })
  })

  test('reports a live lease and locks the button while it runs', () => {
    const now = 200_000
    expect(
      deriveQueueState({
        facts: { ...idle, pendingCount: 1, leaseStartedAt: now - 1 },
        now,
      }),
    ).toEqual({
      leaseLive: true,
      stopped: false,
      button: { label: 'Extraction en cours', disabled: true },
    })
  })

  test('formats a bounded age for queue facts', () => {
    expect(formatAge({ timestamp: 0, now: 30_000 })).toBe('moins d’une minute')
    expect(formatAge({ timestamp: 0, now: 3_600_000 })).toBe('1 h')
  })
})
