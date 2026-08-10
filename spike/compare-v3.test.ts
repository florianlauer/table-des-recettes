// @vitest-environment node
import { expect, test } from 'vitest'
import { compareV3Extraction } from './compare-v3.js'

const recipe = {
  title: 'Soup',
  type: 'entree' as const,
  servings: null,
  ingredients: [{ raw: '1 onion', quantity: 1, unit: null, label: null }],
  steps: ['Cook.'],
}

test('compares printed-list v3 output against the archived shape', () => {
  expect(
    compareV3Extraction({
      baseline: { recipes: [recipe] },
      candidate: { recipes: [{ ...recipe, ingredientsInferred: false }] },
      page: 'a',
    }),
  ).toEqual([])
  expect(
    compareV3Extraction({
      baseline: { recipes: [recipe] },
      candidate: { recipes: [{ ...recipe, ingredientsInferred: true }] },
      page: 'a',
    }),
  ).toContain('printed ingredient list marked inferred')
})
