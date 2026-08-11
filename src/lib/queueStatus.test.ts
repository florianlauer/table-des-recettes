import { describe, expect, test } from 'vitest'
import { LEASE_MS } from './queueContract'
import {
  applyClockOffset,
  formatAge,
  isLeaseLive,
  isQueueStopped,
  queueButtonState,
} from './queueStatus'

describe('queue status', () => {
  test('applies the server offset to a skewed client clock', () => {
    expect(applyClockOffset({ clientNow: 1_000, offsetMs: 4_000 })).toBe(5_000)
  })

  test('expires a lease against the corrected clock', () => {
    expect(isLeaseLive({ startedAt: 1_000, now: 1_000 + LEASE_MS })).toBe(false)
    expect(
      isLeaseLive({
        startedAt: 1_001,
        now: 1_000 + LEASE_MS,
      }),
    ).toBe(true)
  })

  test('does not call a queue stopped while its retry is scheduled', () => {
    expect(
      isQueueStopped({
        pendingCount: 1,
        leaseStartedAt: null,
        nextAttemptAt: 20_000,
        now: 10_000,
      }),
    ).toBe(false)
  })

  test('calls a queue stopped when the retry deadline passes', () => {
    expect(
      isQueueStopped({
        pendingCount: 1,
        leaseStartedAt: null,
        nextAttemptAt: 20_000,
        now: 20_000,
      }),
    ).toBe(true)
  })

  test('selects truthful launch, relaunch, empty, and waiting labels', () => {
    const common = {
      nextAttemptAt: null,
      retryAt: null,
      now: 200_000,
    }
    expect(
      queueButtonState({ pendingCount: 1, leaseStartedAt: null, ...common }),
    ).toEqual({ label: "Démarrer l'extraction", disabled: false })
    expect(
      queueButtonState({ pendingCount: 0, leaseStartedAt: 1, ...common }),
    ).toEqual({ label: 'Relancer la file', disabled: false })
    expect(
      queueButtonState({ pendingCount: 0, leaseStartedAt: null, ...common }),
    ).toEqual({ label: 'Rien à extraire', disabled: true })
    expect(
      queueButtonState({
        pendingCount: 1,
        leaseStartedAt: null,
        ...common,
        nextAttemptAt: 260_000,
      }),
    ).toEqual({ label: 'Reprise dans 1 min', disabled: true })
  })

  test('formats a bounded age for queue facts', () => {
    expect(formatAge({ timestamp: 0, now: 30_000 })).toBe("moins d'une minute")
    expect(formatAge({ timestamp: 0, now: 3_600_000 })).toBe('1 h')
  })
})
