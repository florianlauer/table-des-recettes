import { describe, expect, it } from 'vitest'
import { estimateFrom, MIN_ESTIMATE_SAMPLE } from './estimate'

describe('estimateFrom', () => {
  it('ignores the groups that are not in service, however large', () => {
    expect(
      estimateFrom([
        { attempts: 190, averageLatencyMs: 4_000, isCurrent: false },
        { attempts: 10, averageLatencyMs: 26_000, isCurrent: true },
      ]),
    ).toBe(26_000)
  })

  it('weights several current groups by their call count', () => {
    expect(
      estimateFrom([
        { attempts: 3, averageLatencyMs: 10_000, isCurrent: true },
        { attempts: 1, averageLatencyMs: 30_000, isCurrent: true },
      ]),
    ).toBe(15_000)
  })

  it('says nothing when no group is in service — the first call after a switch', () => {
    expect(
      estimateFrom([
        { attempts: 200, averageLatencyMs: 9_000, isCurrent: false },
      ]),
    ).toBeNull()
  })

  it('says nothing under the minimum sample', () => {
    expect(
      estimateFrom([
        {
          attempts: MIN_ESTIMATE_SAMPLE - 1,
          averageLatencyMs: 9_000,
          isCurrent: true,
        },
      ]),
    ).toBeNull()
  })

  it('says nothing on an empty journal', () => {
    expect(estimateFrom([])).toBeNull()
  })

  it('skips a group whose figures are unusable rather than poisoning the mean', () => {
    expect(
      estimateFrom([
        { attempts: 5, averageLatencyMs: Number.NaN, isCurrent: true },
        { attempts: 4, averageLatencyMs: 12_000, isCurrent: true },
      ]),
    ).toBe(12_000)
  })

  it('says nothing when every current group is unusable', () => {
    expect(
      estimateFrom([
        { attempts: 0, averageLatencyMs: 9_000, isCurrent: true },
        { attempts: 5, averageLatencyMs: 0, isCurrent: true },
      ]),
    ).toBeNull()
  })
})
