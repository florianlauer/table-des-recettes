import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vitest'
import type { WireBeautifySummary } from '../shared/beautifyStats'
import type { NonEmpty } from '../shared/journalStats'
import { BeautifyStats } from './-BeautifyStats'

function group(over: Partial<WireBeautifySummary> = {}): WireBeautifySummary {
  return {
    model: 'google/gemini-2.5-flash-image',
    promptVersion: 'v2',
    servedProvider: 'Google AI Studio',
    attempts: 10,
    pending: 1,
    accepted: 6,
    rejected: 2,
    discarded: 0,
    technicalFailures: 1,
    failureRate: 0.1,
    failureKinds: [{ kind: 'refusal', count: 1 }],
    totalCostUsd: 0.4,
    averageCostUsd: 0.04,
    averageLatencyMs: 9000,
    unreportedCostCalls: 0,
    excessiveCostCalls: 0,
    isCurrent: true,
    ...over,
  }
}

describe('BeautifyStats', () => {
  test('every row carries as many cells as there are columns', () => {
    const rows = [
      group(),
      group({ promptVersion: 'v3', isCurrent: false }),
    ] as NonEmpty<WireBeautifySummary>
    const markup = renderToStaticMarkup(<BeautifyStats rows={rows} />)

    const cells = [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(
      ([, row]) => [...(row ?? '').matchAll(/<t[hd][\s>]/g)].length,
    )
    expect(cells[0]).toBe(10)
    // Heading, two configurations, one total — and two detail rows that span instead of filling.
    expect(cells.filter((count) => count === 10)).toHaveLength(4)
    expect(cells.filter((count) => count === 1)).toHaveLength(2)
  })

  test('keeps the two caveats about the cost under the row they belong to', () => {
    const rows = [
      group({ unreportedCostCalls: 2, excessiveCostCalls: 1 }),
    ] as NonEmpty<WireBeautifySummary>
    const markup = renderToStaticMarkup(<BeautifyStats rows={rows} />)

    expect(markup).toContain('2 appels sans coût rapporté')
    expect(markup).toContain('role="alert"')
  })

  test('totals the configurations, weighted by calls', () => {
    const rows = [
      group({ attempts: 9, averageLatencyMs: 1000, totalCostUsd: 0.009 }),
      group({
        promptVersion: 'v3',
        attempts: 1,
        averageLatencyMs: 11_000,
        totalCostUsd: 0.011,
      }),
    ] as NonEmpty<WireBeautifySummary>
    const markup = renderToStaticMarkup(<BeautifyStats rows={rows} />)

    expect(markup).toContain('2 configurations')
    // Averaging the two group averages would print 6 000 ms.
    expect(markup).toMatch(/2\s?000 ms/u)
  })
})
