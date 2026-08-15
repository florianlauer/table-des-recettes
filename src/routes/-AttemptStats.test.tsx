import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vitest'
import type { WireAttemptSummary } from '../shared/attemptStats'
import type { NonEmpty } from '../shared/journalStats'
import { AttemptStatsTable } from './-AttemptStats'

function group(over: Partial<WireAttemptSummary> = {}): WireAttemptSummary {
  return {
    model: 'google/gemini-3-flash',
    promptVersion: 'v4',
    schemaVersion: 'v2',
    servedProvider: 'Google AI Studio',
    attempts: 10,
    failures: 1,
    failureRate: 0.1,
    failureKinds: [{ kind: 'timeout', count: 1 }],
    repairs: 2,
    repairedAttempts: 1,
    totalCostUsd: 0.02,
    averageCostUsd: 0.002,
    averageLatencyMs: 3000,
    isCurrent: true,
    ...over,
  }
}

/** Cells per row, so a row that has fallen out of step with the heading fails here. */
function cellsPerRow(markup: string): number[] {
  return [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(
    ([, row]) => [...(row ?? '').matchAll(/<t[hd][\s>]/g)].length,
  )
}

describe('AttemptStatsTable', () => {
  test('every row carries as many cells as there are columns', () => {
    const rows = [
      group(),
      group({ model: 'mistralai/ministral-8b', isCurrent: false }),
    ] as NonEmpty<WireAttemptSummary>
    const markup = renderToStaticMarkup(<AttemptStatsTable rows={rows} />)

    // Heading, two readings, two detail rows, one total: the detail rows span instead of filling.
    const cells = cellsPerRow(markup)
    const columns = cells[0]
    expect(columns).toBe(7)
    expect(cells.filter((count) => count === columns)).toHaveLength(4)
    expect(cells.filter((count) => count === 1)).toHaveLength(2)
  })

  test('totals the readings at the foot, weighted rather than averaged', () => {
    const rows = [
      group({
        attempts: 9,
        failures: 0,
        failureRate: 0,
        averageLatencyMs: 1000,
      }),
      group({
        model: 'mistralai/ministral-8b',
        attempts: 1,
        failures: 1,
        failureRate: 1,
        averageLatencyMs: 11_000,
      }),
    ] as NonEmpty<WireAttemptSummary>
    const markup = renderToStaticMarkup(<AttemptStatsTable rows={rows} />)

    expect(markup).toContain('<tfoot>')
    expect(markup).toContain('2 lectures')
    // Averaging the two group averages would print 6 000 ms.
    expect(markup).toMatch(/2\s?000 ms/u)
  })

  test('flags the reading in service inside the model column, not as a fourth line', () => {
    const rows = [group()] as NonEmpty<WireAttemptSummary>
    const markup = renderToStaticMarkup(<AttemptStatsTable rows={rows} />)
    expect(markup).toContain('class="admin-table__flag"> en service')
  })

  test('rides the rest of the identity under the model, schema included', () => {
    // The extraction journal is the one of the two that has a schema version; the shared line prints
    // the segment only where there is one to print.
    const markup = renderToStaticMarkup(
      <AttemptStatsTable rows={[group()] as NonEmpty<WireAttemptSummary>} />,
    )
    expect(markup).toContain('Google AI Studio')
    expect(markup).toContain('prompt v4')
    expect(markup).toContain('schéma v2')
    expect(markup).toContain('timeout 1')
  })

  test('names a provider the journal never recorded', () => {
    const markup = renderToStaticMarkup(
      <AttemptStatsTable
        rows={[group({ servedProvider: null })] as NonEmpty<WireAttemptSummary>}
      />,
    )
    expect(markup).toContain('provider inconnu')
  })
})
