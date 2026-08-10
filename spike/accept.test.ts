import { describe, expect, it } from 'vitest'

import {
  acceptanceVerdict,
  acceptanceTruthSchema,
  classifyAcceptance,
  classifyTextDifference,
  compareReadings,
  LOWER_SIMILARITY_BOUND,
  UPPER_SIMILARITY_BOUND,
} from './accept.js'
import type { AcceptanceTruth } from './accept.js'

const truth: AcceptanceTruth = {
  recipes: [
    {
      title: 'Crème brûlée',
      type: 'dessert',
      servings: 4,
      ingredients: [{ raw: '50 cl de crème' }, { raw: "4 jaunes d'œufs" }],
      steps: ['Chauffez la crème.', 'Mélangez les jaunes.'],
    },
  ],
}

function actual(overrides: Record<string, unknown> = {}): unknown {
  return {
    recipes: [
      {
        title: truth.recipes[0]!.title,
        type: truth.recipes[0]!.type,
        servings: truth.recipes[0]!.servings,
        ingredients: truth.recipes[0]!.ingredients.map(({ raw }) => ({
          raw,
          quantity: null,
          unit: null,
          label: null,
        })),
        steps: [...truth.recipes[0]!.steps],
        ...overrides,
      },
    ],
  }
}

function expectHard(candidate: unknown, category: string): void {
  const result = classifyAcceptance({ actual: candidate, truth })
  expect(result.passesHardGates).toBe(false)
  expect(result.hardGates.map((issue) => issue.category)).toContain(category)
}

describe('acceptance classification', () => {
  it('classifies structural defects as hard gates', () => {
    expectHard({ recipes: [] }, 'wrong_recipe_count')
    expectHard(
      actual({
        ingredients: [
          { raw: '50 cl de crème', quantity: null, unit: null, label: null },
        ],
      }),
      'missing_or_merged_ingredient',
    )
    expectHard(
      actual({
        ingredients: [
          ...truth.recipes[0]!.ingredients.map(({ raw }) => ({
            raw,
            quantity: null,
            unit: null,
            label: null,
          })),
          { raw: 'Une licorne', quantity: null, unit: null, label: null },
        ],
      }),
      'invented_ingredient',
    )
    expectHard(
      actual({
        ingredients: [
          { raw: '50 cl de crème', quantity: null, unit: null, label: null },
          {
            raw: 'Une licorne violette',
            quantity: null,
            unit: null,
            label: null,
          },
        ],
      }),
      'invented_or_missing_ingredient',
    )
    expectHard(
      actual({
        ingredients: [
          {
            raw: "50 cl de crème et 4 jaunes d'œufs",
            quantity: null,
            unit: null,
            label: null,
          },
        ],
      }),
      'missing_or_merged_ingredient',
    )
    expectHard(actual({ steps: [truth.recipes[0]!.steps[0]] }), 'missing_step')
    expectHard(
      actual({ steps: [truth.recipes[0]!.steps[0], 'Servez sur la lune.'] }),
      'missing_step',
    )
    expectHard(
      actual({ steps: [...truth.recipes[0]!.steps].reverse() }),
      'out_of_order_step',
    )
    expectHard({ recipes: [{ title: 42 }] }, 'invalid_schema')
  })

  it('rejects a textual servings in the ground truth', () => {
    expect(
      acceptanceTruthSchema.safeParse({
        recipes: [{ ...truth.recipes[0]!, servings: '4' }],
      }).success,
    ).toBe(false)
  })

  it('classifies local corrections as editable gaps', () => {
    const result = classifyAcceptance({
      actual: actual({
        title: 'Une creme BRULEE maison',
        type: 'autre',
        servings: null,
        ingredients: [
          { raw: '50 cl de creme', quantity: null, unit: null, label: null },
          { raw: "4 JAUNES d'œufs", quantity: null, unit: null, label: null },
        ],
        steps: ['Chaufez la crème.', truth.recipes[0]!.steps[1]],
      }),
      truth,
    })
    expect(result.passesHardGates).toBe(true)
    expect(result.editableGaps.map((issue) => issue.category)).toEqual(
      expect.arrayContaining([
        'reformulated_title',
        'wrong_type',
        'wrong_servings',
        'ingredient_text',
        'step_text',
      ]),
    )
  })

  it('applies the three similarity branches and blocks the uncertainty band', () => {
    expect(LOWER_SIMILARITY_BOUND).toBe(0.6)
    expect(UPPER_SIMILARITY_BOUND).toBe(0.85)
    expect(classifyTextDifference('abcdefghij', 'zzzzzzzzzz')).toBe('hard_gate')
    expect(classifyTextDifference('abcdefghij', 'abcdefZZZZ')).toBe(
      'a_trancher_humain',
    )
    expect(classifyTextDifference('abcdefghij', 'abcdefghiX')).toBe('editable')

    const uncertainTruth: AcceptanceTruth = {
      recipes: [{ ...truth.recipes[0]!, ingredients: [{ raw: 'abcdefghij' }] }],
    }
    const result = classifyAcceptance({
      actual: actual({
        ingredients: [
          { raw: 'abcdefZZZZ', quantity: null, unit: null, label: null },
        ],
      }),
      truth: uncertainTruth,
    })
    expect(result.passesHardGates).toBe(false)
    expect(result.hardGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'a_trancher_humain' }),
      ]),
    )
    expect(result.humanReview).toEqual([
      expect.objectContaining({ category: 'a_trancher_humain' }),
    ])
  })

  // The whole point of keeping both readings: a correction pass that drifts away from the truth has
  // to be visible, otherwise the verdict silently credits the corrector for degrading the text.
  it('counts what the correction pass resorbed and what it created', () => {
    const raw = classifyAcceptance({
      actual: actual({ steps: ['Chaufez la crème.', 'Melangez les jaunes.'] }),
      truth,
    })
    const corrected = classifyAcceptance({
      actual: actual({
        steps: [truth.recipes[0]!.steps[0], 'Mélangeons les jaunes.'],
      }),
      truth,
    })

    expect(raw.editableGaps).toHaveLength(2)
    expect(compareReadings({ raw, corrected })).toMatchObject({
      resorbed: 2,
      created: 1,
      hardGatesDiverge: false,
    })
  })

  // Cardinalities would report no divergence here: one hard gate before, one after. What matters is
  // that it is not the same one — the pass crossed a boundary, and counting cannot see it.
  it('sees a hard gate swapped for another one', () => {
    const raw = classifyAcceptance({
      actual: actual({
        ingredients: [
          { raw: '50 cl de crème', quantity: 50, unit: 'cl', label: null },
        ],
      }),
      truth,
    })
    const corrected = classifyAcceptance({
      actual: actual({ steps: [truth.recipes[0]!.steps[0]] }),
      truth,
    })

    expect(raw.hardGates).toHaveLength(1)
    expect(corrected.hardGates).toHaveLength(1)
    expect(compareReadings({ raw, corrected }).hardGatesDiverge).toBe(true)
  })

  it('accepts only two passes clear of hard gates and yields an exit code', () => {
    const clear = classifyAcceptance({ actual: actual(), truth })
    const reading = { rawClassification: clear, corrections: [] }
    expect(
      acceptanceVerdict([
        { pass: 1, status: 'success', classification: clear, ...reading },
        { pass: 2, status: 'success', classification: clear, ...reading },
      ]),
    ).toEqual({
      accepted: true,
      exitCode: 0,
      line: 'ACCEPTÉ — les deux passes franchissent tous les hard gates.',
    })

    const rejected = acceptanceVerdict([
      { pass: 1, status: 'success', classification: clear, ...reading },
      {
        pass: 2,
        status: 'failure',
        classification: null,
        rawClassification: null,
        corrections: [],
      },
    ])
    expect(rejected).toMatchObject({ accepted: false, exitCode: 1 })
    expect(rejected.line).toContain('REJETÉ — passe 2: failure')
  })
})
