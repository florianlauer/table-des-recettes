import { describe, expect, it } from 'vitest'
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT_VERSION } from './beautifyPrompt'
import {
  configuredBeautifyIdentity,
  configuredExtractionIdentity,
} from './currentIdentity'
import {
  estimateFrom,
  markCurrent,
  MIN_ESTIMATE_SAMPLE,
  nonEmpty,
  normalizeProviderIdentifier,
} from './journalStats'
import type { JournalGroupIdentity } from './journalStats'
import { PROMPT_VERSION } from './recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from './recipe-schema'

describe('nonEmpty', () => {
  it('refuses an empty list rather than handing back a tuple type that lies', () => {
    expect(nonEmpty([])).toBeNull()
  })

  it('hands the same list back, now typed as holding at least one row', () => {
    const rows = [1, 2, 3]
    const checked = nonEmpty(rows)
    expect(checked).toBe(rows)
    // The point of the type: row zero reads without a cast and without a runtime check.
    if (checked) expect(checked[0]).toBe(1)
  })
})

describe('normalizeProviderIdentifier', () => {
  it('matches the pinned slug against the served display name', () => {
    expect(normalizeProviderIdentifier('google-ai-studio')).toBe(
      normalizeProviderIdentifier('Google AI Studio'),
    )
  })

  it('ignores underscores and doubled spaces too', () => {
    expect(normalizeProviderIdentifier('google_ai  studio')).toBe(
      normalizeProviderIdentifier('Google AI Studio'),
    )
  })

  it('keeps two genuinely different providers apart', () => {
    expect(normalizeProviderIdentifier('google-vertex')).not.toBe(
      normalizeProviderIdentifier('google-ai-studio'),
    )
  })

  it('lowercases on the invariant locale', () => {
    expect(normalizeProviderIdentifier('AI21')).toBe('ai21')
  })
})

describe('markCurrent, against an extraction identity', () => {
  const identity = configuredExtractionIdentity({
    OPENROUTER_MODEL: 'a/model',
    OPENROUTER_PROVIDER: 'google-ai-studio',
  })
  const group: JournalGroupIdentity = {
    model: 'a/model',
    servedProvider: 'Google AI Studio',
    promptVersion: PROMPT_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
  }
  const marks = (over: Partial<typeof group> = {}) =>
    markCurrent([{ ...group, ...over }], identity)[0]?.isCurrent

  it('marks the group the deployment pins', () => {
    expect(marks()).toBe(true)
  })

  it('rejects another model', () => {
    expect(marks({ model: 'other' })).toBe(false)
  })

  it('rejects another provider', () => {
    expect(marks({ servedProvider: 'Together' })).toBe(false)
  })

  it('rejects a stale prompt version', () => {
    expect(marks({ promptVersion: 'v1' })).toBe(false)
  })

  it('rejects a stale schema version', () => {
    expect(marks({ schemaVersion: '1' })).toBe(false)
  })

  it('rejects a group whose provider was never reported', () => {
    expect(marks({ servedProvider: null })).toBe(false)
  })

  it('marks nothing when nothing is pinned', () => {
    expect(markCurrent([group], null)[0]?.isCurrent).toBe(false)
  })

  it('leaves the group otherwise untouched', () => {
    expect(markCurrent([group], identity)[0]).toMatchObject(group)
  })
})

describe('markCurrent, against a beautification identity', () => {
  const identity = configuredBeautifyIdentity()
  const group = {
    model: BEAUTIFY_MODEL,
    promptVersion: BEAUTIFY_PROMPT_VERSION,
    servedProvider: 'Google Vertex',
  }

  // The whole reason the identity carries optional fields: a journal that pins no provider must not
  // have one compared, or every group of the model in service would read as retired.
  it('marks the current model whatever provider served it', () => {
    expect(
      markCurrent(
        [group, { ...group, servedProvider: 'Google AI Studio' }],
        identity,
      ).map((marked) => marked.isCurrent),
    ).toEqual([true, true])
  })

  it('rejects a superseded prompt version', () => {
    expect(
      markCurrent([{ ...group, promptVersion: 'v1' }], identity)[0]?.isCurrent,
    ).toBe(false)
  })
})

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
