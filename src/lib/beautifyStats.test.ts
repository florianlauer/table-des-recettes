import { describe, expect, test } from 'vitest'
import {
  BEAUTIFY_EXPECTED_COST_USD,
  BEAUTIFY_COST_ALERT_FACTOR,
} from './beautifyPrompt'
import { summarizeBeautifyAttempts } from './beautifyStats'
import type { JournalledBeautifyAttempt } from './beautifyStats'

function row(
  over: Partial<JournalledBeautifyAttempt> = {},
): JournalledBeautifyAttempt {
  return {
    model: 'google/gemini-2.5-flash-image',
    promptVersion: 'v2',
    outcome: 'pending',
    failureKind: null,
    costUsd: BEAUTIFY_EXPECTED_COST_USD,
    costReported: true,
    latencyMs: 9100,
    ...over,
  }
}

describe('beautification journal reading', () => {
  test('counts the four outcomes apart from the technical failures', () => {
    const [group] = summarizeBeautifyAttempts([
      row({ outcome: 'accepted' }),
      row({ outcome: 'rejected' }),
      row({ outcome: 'pending' }),
      // A finalisation that arrived too late: billed, unusable, but not a failure of the model.
      row({ outcome: 'discarded' }),
      row({ outcome: 'discarded', failureKind: 'no_image' }),
    ])
    expect(group).toMatchObject({
      attempts: 5,
      accepted: 1,
      rejected: 1,
      pending: 1,
      discarded: 2,
      technicalFailures: 1,
    })
    expect(group?.failureKinds).toEqual([{ kind: 'no_image', count: 1 }])
  })

  test('flags calls whose price was never reported, so the total reads as a floor', () => {
    const [group] = summarizeBeautifyAttempts([
      row(),
      row({ costUsd: 0, costReported: false }),
    ])
    expect(group?.unreportedCostCalls).toBe(1)
    expect(group?.totalCostUsd).toBeCloseTo(BEAUTIFY_EXPECTED_COST_USD, 6)
  })

  test('flags a call billed far above the measured cost, without preventing anything', () => {
    const [group] = summarizeBeautifyAttempts([
      row(),
      row({
        costUsd: BEAUTIFY_EXPECTED_COST_USD * (BEAUTIFY_COST_ALERT_FACTOR + 1),
      }),
    ])
    expect(group?.excessiveCostCalls).toBe(1)
  })

  test('separates prompt versions, and keeps the newest group first', () => {
    const summaries = summarizeBeautifyAttempts([
      row({ promptVersion: 'v3' }),
      row({ promptVersion: 'v2' }),
    ])
    expect(summaries.map((group) => group.promptVersion)).toEqual(['v3', 'v2'])
  })
})
