import { describe, expect, it } from 'vitest'

import type { PassResult } from './openrouter.js'
import {
  condemnsWholeModel,
  decideRung,
  DEFAULT_MAX_LATENCY_SECONDS,
  PROBE_PAGE,
} from './walk.js'

function success(latencyMs: number): PassResult {
  return {
    status: 'success',
    parsed: { recipes: [] },
    raw: {},
    attempts: 1,
    latencyMs,
    actualCostUsd: 0.0005,
    servedProvider: 'Groq',
    repairs: [],
  }
}

function failure(reason: 'invalid_schema' | 'unsupported_request'): PassResult {
  return {
    status: 'failure',
    reason,
    detail: 'detail',
    attempts: 1,
    latencyMs: 900,
    actualCostUsd: 0.0005,
  }
}

describe('ladder walk', () => {
  // The floor is derived, not picked: page B weighs ~3400 output tokens and the protocol needs at
  // least 85 tokens/s to stay clear of the 120 s timeout. Changing one without the other silently
  // turns the gate into a quality judgement.
  it('probes the discriminating page with a floor derived from its size', () => {
    expect(PROBE_PAGE).toBe('b')
    expect(DEFAULT_MAX_LATENCY_SECONDS).toBe(40)
  })

  it('keeps a rung whose probe lands under the latency floor', () => {
    expect(
      decideRung({ result: success(2_100), maximumLatencySeconds: 10 }),
    ).toEqual({
      verdict: 'retenu',
      latencySeconds: 2.1,
    })
  })

  // darkbloom answered in 84 s on a single-recipe page, then timed out on the four-recipe page:
  // the floor exists to drop that endpoint on one call instead of six.
  it('drops a rung that is too slow even when the extraction succeeds', () => {
    expect(
      decideRung({ result: success(84_000), maximumLatencySeconds: 10 }),
    ).toMatchObject({ verdict: 'trop_lent' })
  })

  it('separates a model failure from a transient one', () => {
    expect(
      decideRung({
        result: failure('invalid_schema'),
        maximumLatencySeconds: 10,
      }),
    ).toMatchObject({
      verdict: 'echec_modele',
    })
    expect(
      decideRung({
        result: {
          status: 'inconclusive',
          reason: 'transient_error',
          detail: 'AbortError',
          attempts: 3,
          latencyMs: 361_000,
          actualCostUsd: 0,
        },
        maximumLatencySeconds: 10,
      }),
    ).toMatchObject({ verdict: 'inconcluant' })
  })

  it('treats a rung answering exactly at the floor as kept', () => {
    expect(
      decideRung({ result: success(10_000), maximumLatencySeconds: 10 }),
    ).toMatchObject({ verdict: 'retenu' })
  })

  // A capability refusal accuses the endpoint alone; anything else accuses the model, so the model's
  // other endpoints are worth skipping — llama-4-scout merging every step failed identically everywhere.
  it('condemns the whole model only for a failure that is not a capability refusal', () => {
    expect(condemnsWholeModel(failure('invalid_schema'))).toBe(true)
    expect(condemnsWholeModel(failure('unsupported_request'))).toBe(false)
    expect(condemnsWholeModel(success(2_000))).toBe(false)
  })
})
