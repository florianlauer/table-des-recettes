import { describe, expect, it, vi } from 'vitest'

import type { Extraction } from '../src/shared/recipe-schema.js'
import { BudgetCounter } from './budget.js'
import { acceptText, mergeCorrection, runCorrectionPass } from './correct.js'

const original: Extraction = {
  recipes: [
    {
      title: 'Dinde aux piments et au cacao',
      type: 'plat',
      servings: 6,
      ingredients: [
        {
          raw: '2 filets de dinde de 500 g',
          quantity: 2,
          unit: null,
          label: null,
        },
        {
          raw: '20 g de cacao brut',
          quantity: 20,
          unit: 'g',
          label: 'cacao brut',
        },
      ],
      ingredientsInferred: false,
      steps: [
        'Pivrez, salez et laissez mijoter 20 min.',
        'Par-semez le plat de sésame.',
      ],
    },
  ],
}

function corrected(overrides: Partial<Extraction['recipes'][number]>): unknown {
  return { recipes: [{ ...original.recipes[0]!, ...overrides }] }
}

describe('correction pass', () => {
  it('keeps a typo fix and reports it', () => {
    const { value, corrections } = mergeCorrection({
      original,
      corrected: corrected({
        steps: [
          'Poivrez, salez et laissez mijoter 20 min.',
          'Parsemez le plat de sésame.',
        ],
      }),
    })
    expect(value.recipes[0]?.steps).toEqual([
      'Poivrez, salez et laissez mijoter 20 min.',
      'Parsemez le plat de sésame.',
    ])
    expect(corrections).toHaveLength(2)
    expect(corrections[0]?.path).toBe('recipes.0.steps.0')
  })

  // The cheapest guardrail against the costliest drift: a typo never moves a digit, so "500 g" read
  // back as "50 g" is a rewrite pretending to be a correction.
  it('refuses a correction that moves a digit', () => {
    const { value, corrections } = mergeCorrection({
      original,
      corrected: corrected({
        ingredients: [
          {
            raw: '2 filets de dinde de 50 g',
            quantity: 2,
            unit: null,
            label: null,
          },
          original.recipes[0]!.ingredients[1]!,
        ],
      }),
    })
    expect(value.recipes[0]?.ingredients[0]?.raw).toBe(
      '2 filets de dinde de 500 g',
    )
    expect(corrections).toEqual([])
  })

  it('refuses a rewrite dressed up as a correction', () => {
    expect(
      acceptText({
        original: 'Pivrez, salez et laissez mijoter 20 min.',
        corrected: 'Assaisonnez puis cuisez.',
      }),
    ).toBe('Pivrez, salez et laissez mijoter 20 min.')
  })

  // A pass that returns a different shape has re-extracted rather than proofread; the first
  // extraction stands, since its segmentation is exactly what the ladder validated.
  it('discards a pass that changes any count', () => {
    const dropped = mergeCorrection({
      original,
      corrected: corrected({ steps: ['Poivrez, salez.'] }),
    })
    expect(dropped.value).toEqual(original)
    expect(dropped.corrections).toEqual([])

    const extraRecipe = mergeCorrection({
      original,
      corrected: { recipes: [original.recipes[0]!, original.recipes[0]!] },
    })
    expect(extraRecipe.value).toEqual(original)
  })

  it('leaves numeric fields alone even when the pass alters them', () => {
    const { value } = mergeCorrection({
      original,
      corrected: corrected({ servings: 12 }),
    })
    expect(value.recipes[0]?.servings).toBe(6)
  })
})

// These two pin the pass to the shared transport rather than to a second client of its own: the
// capability flags and the provider check are exactly what the duplicate silently lacked.
describe('correction pass over the shared transport', () => {
  function call(overrides: Record<string, unknown> = {}) {
    return {
      extraction: original,
      model: 'author/model',
      providerSlug: 'provider-a',
      providerName: 'Provider A',
      apiKey: 'test-key',
      budget: new BudgetCounter(),
      maximumEstimatedCostUsd: 0.05,
      sleep: async () => undefined,
      timeoutMs: 10,
      ...overrides,
    }
  }

  it('omits temperature on an endpoint that rejects it', async () => {
    const sent: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>)
      return new Response(
        JSON.stringify({
          provider: 'Provider A',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(original) },
            },
          ],
          usage: { cost: 0.0003 },
        }),
      )
    }) as unknown as typeof fetch

    const { costUsd } = await runCorrectionPass(
      call({ supportsTemperature: false, fetchImpl: fetchMock }),
    )

    expect(sent[0]).not.toHaveProperty('temperature')
    expect(costUsd).toBe(0.0003)
  })

  it('keeps the first extraction when the pass never answers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
        }),
    ) as unknown as typeof fetch

    const { value, corrections } = await runCorrectionPass(
      call({ fetchImpl: fetchMock }),
    )

    expect(value).toEqual(original)
    expect(corrections).toEqual([])
  })
})
