import { describe, expect, test } from 'vitest'
import type { JournalledAttempt } from './attemptStats'
import { summarizeAttempts } from './attemptStats'

function attempt(
  overrides: Partial<JournalledAttempt> = {},
): JournalledAttempt {
  return {
    model: 'google/gemini-3-flash-preview',
    promptVersion: 'v4',
    schemaVersion: '2',
    failureKind: null,
    costUsd: 0.005,
    latencyMs: 7000,
    repairCount: 0,
    ...overrides,
  }
}

describe('attempt statistics', () => {
  test('reports nothing when the journal is empty', () => {
    expect(summarizeAttempts([])).toEqual([])
  })

  test('averages cost and latency over the attempts of one prompt version', () => {
    const summary = summarizeAttempts([
      attempt({ costUsd: 0.004, latencyMs: 6000 }),
      attempt({ costUsd: 0.006, latencyMs: 8000 }),
    ])
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      attempts: 2,
      failures: 0,
      failureRate: 0,
      totalCostUsd: 0.01,
      averageCostUsd: 0.005,
      averageLatencyMs: 7000,
    })
  })

  test('counts a failed attempt as billed, since the answer is charged before it is rejected', () => {
    const summary = summarizeAttempts([
      attempt({ failureKind: 'truncated', costUsd: 0.003 }),
      attempt({ costUsd: 0.005 }),
    ])
    expect(summary[0]).toMatchObject({
      attempts: 2,
      failures: 1,
      failureRate: 0.5,
      totalCostUsd: 0.008,
    })
  })

  test('breaks failures down by kind, most frequent first', () => {
    const summary = summarizeAttempts([
      attempt({ failureKind: 'timeout' }),
      attempt({ failureKind: 'truncated' }),
      attempt({ failureKind: 'timeout' }),
    ])
    expect(summary[0]?.failureKinds).toEqual([
      { kind: 'timeout', count: 2 },
      { kind: 'truncated', count: 1 },
    ])
  })

  test('separates the volume of repair from the number of attempts that needed one', () => {
    const summary = summarizeAttempts([
      attempt({ repairCount: 3 }),
      attempt({ repairCount: 1 }),
      attempt({ repairCount: 0 }),
    ])
    expect(summary[0]).toMatchObject({ repairs: 4, repairedAttempts: 2 })
  })

  test('splits model, prompt version and schema version into separate rows', () => {
    const summary = summarizeAttempts([
      attempt({ promptVersion: 'v4' }),
      attempt({ promptVersion: 'v3' }),
      attempt({ promptVersion: 'v4', schemaVersion: '1' }),
      attempt({ model: 'mistralai/ministral-8b-2512' }),
    ])
    expect(
      summary.map(({ model, promptVersion, schemaVersion, attempts }) => ({
        model,
        promptVersion,
        schemaVersion,
        attempts,
      })),
    ).toEqual([
      {
        model: 'google/gemini-3-flash-preview',
        promptVersion: 'v4',
        schemaVersion: '2',
        attempts: 1,
      },
      {
        model: 'google/gemini-3-flash-preview',
        promptVersion: 'v3',
        schemaVersion: '2',
        attempts: 1,
      },
      {
        model: 'google/gemini-3-flash-preview',
        promptVersion: 'v4',
        schemaVersion: '1',
        attempts: 1,
      },
      {
        model: 'mistralai/ministral-8b-2512',
        promptVersion: 'v4',
        schemaVersion: '2',
        attempts: 1,
      },
    ])
  })

  test('keeps the newest combination first, so the one in force reads before the ones it replaced', () => {
    const summary = summarizeAttempts([
      attempt({ promptVersion: 'v4' }),
      attempt({ promptVersion: 'v3' }),
      attempt({ promptVersion: 'v3' }),
      attempt({ promptVersion: 'v3' }),
    ])
    expect(summary.map(({ promptVersion }) => promptVersion)).toEqual([
      'v4',
      'v3',
    ])
  })
})
