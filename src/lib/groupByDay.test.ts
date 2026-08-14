import { describe, expect, test } from 'vitest'
import { dayKey, groupByDay } from './groupByDay'

/** 2026-08-14 12:00 Paris, the reference "now" for every year-elision assertion below. */
const NOW = Date.UTC(2026, 7, 14, 10, 0)

const at = (ms: number) => ({ updatedAt: ms })

describe('groupByDay', () => {
  test('groups consecutive rows of the same day', () => {
    const groups = groupByDay(
      [
        at(Date.UTC(2026, 7, 14, 9, 0)),
        at(Date.UTC(2026, 7, 14, 8, 0)),
        at(Date.UTC(2026, 7, 3, 8, 0)),
      ],
      NOW,
    )
    expect(groups.map((group) => group.items.length)).toEqual([2, 1])
    expect(groups.map((group) => group.label)).toEqual(['14 août', '3 août'])
  })

  // The index order is the display order. Sorting here would disagree with the truncation the server
  // reported, so a day that reappears later gets its own group rather than being merged backwards.
  test('never reorders: a repeated day opens a second group', () => {
    const groups = groupByDay(
      [
        at(Date.UTC(2026, 7, 14, 9, 0)),
        at(Date.UTC(2026, 7, 3, 8, 0)),
        at(Date.UTC(2026, 7, 14, 7, 0)),
      ],
      NOW,
    )
    expect(groups.map((group) => group.label)).toEqual([
      '14 août',
      '3 août',
      '14 août',
    ])
  })

  test('keeps the year when it is not the current one', () => {
    const groups = groupByDay([at(Date.UTC(2025, 10, 2, 12, 0))], NOW)
    expect(groups[0]?.label).toBe('2 novembre 2025')
  })

  test('an empty list yields no group', () => {
    expect(groupByDay([], NOW)).toEqual([])
  })
})

describe('dayKey', () => {
  /**
   * The whole reason the zone is hard-coded. 22:30 UTC on 14 August is already 15 August in Paris
   * (UTC+2 in summer); read in UTC — which is what the Vercel server does — it would be the 14th,
   * and the server and client renders would disagree.
   */
  test('reads midnight in Paris, not in UTC', () => {
    expect(dayKey(Date.UTC(2026, 7, 14, 22, 30))).toBe('2026-08-15')
    expect(dayKey(Date.UTC(2026, 7, 14, 21, 30))).toBe('2026-08-14')
  })

  test('follows the winter offset too', () => {
    // UTC+1 in January, so the boundary moves by an hour: 22:30 UTC is still the 14th in Paris.
    expect(dayKey(Date.UTC(2026, 0, 14, 23, 30))).toBe('2026-01-15')
    expect(dayKey(Date.UTC(2026, 0, 14, 22, 30))).toBe('2026-01-14')
  })
})
