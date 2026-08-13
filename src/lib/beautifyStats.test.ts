import { describe, expect, test } from 'vitest'
import {
  BEAUTIFY_EXPECTED_COST_USD,
  BEAUTIFY_COST_ALERT_FACTOR,
} from './beautifyPrompt'
import { beautifyTotals, summarizeBeautifyAttempts } from './beautifyStats'
import { nonEmpty } from './journalStats'
import type { JournalledBeautifyAttempt } from './beautifyStats'

function row(
  over: Partial<JournalledBeautifyAttempt> = {},
): JournalledBeautifyAttempt {
  return {
    model: 'google/gemini-2.5-flash-image',
    promptVersion: 'v2',
    servedProvider: 'Google AI Studio',
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

/** The summaries under test always hold something; the type has to be told, and `nonEmpty` is how. */
function summarized(rows: JournalledBeautifyAttempt[]) {
  const summary = nonEmpty(summarizeBeautifyAttempts(rows))
  if (summary === null) throw new Error('no summary to total')
  return summary
}

describe('beautifyTotals', () => {
  test('weights the failure rate by calls rather than averaging the groups', () => {
    const totals = beautifyTotals(
      summarized([
        // Nine calls of one configuration with one failure, against one call of another that failed:
        // averaging the two rates would report 55%, the truth is 20%.
        ...Array.from({ length: 8 }, () => row()),
        row({ failureKind: 'refusal' }),
        row({ promptVersion: 'v3', failureKind: 'refusal' }),
      ]),
    )

    expect(totals.attempts).toBe(10)
    expect(totals.technicalFailures).toBe(2)
    expect(totals.failureRate).toBeCloseTo(0.2)
  })

  test('weights the average latency and cost by calls', () => {
    const totals = beautifyTotals(
      summarized([
        ...Array.from({ length: 9 }, () =>
          row({ latencyMs: 1000, costUsd: 0.001 }),
        ),
        row({ promptVersion: 'v3', latencyMs: 11_000, costUsd: 0.011 }),
      ]),
    )

    // Averaging the two group averages would give 6 000 ms; the ten calls really took 2 000.
    expect(totals.averageLatencyMs).toBeCloseTo(2000)
    expect(totals.totalCostUsd).toBeCloseTo(0.02)
    expect(totals.averageCostUsd).toBeCloseTo(0.002)
  })

  test('carries the two caveats up, so the total says the same thing a group does', () => {
    const totals = beautifyTotals(
      summarized([row({ costReported: false }), row({ promptVersion: 'v3' })]),
    )
    expect(totals.unreportedCostCalls).toBe(1)
  })
})
