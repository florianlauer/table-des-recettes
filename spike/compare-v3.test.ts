// @vitest-environment node
import { expect, test } from 'vitest'
import {
  compareV3Extraction,
  PAGE_E_EXPECTED_INGREDIENTS,
} from './compare-v3.js'

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
  ).toEqual({ fatal: [], advisory: [] })
  expect(
    compareV3Extraction({
      baseline: { recipes: [recipe] },
      candidate: { recipes: [{ ...recipe, ingredientsInferred: true }] },
      page: 'a',
    }).fatal,
  ).toEqual(['Soup: ingredientsInferred is true, the page prints a list'])
})

test('an ingredient line rewritten on a printed-list page is fatal', () => {
  expect(
    compareV3Extraction({
      baseline: { recipes: [recipe] },
      candidate: {
        recipes: [
          {
            ...recipe,
            ingredientsInferred: false,
            ingredients: [
              { raw: '1 large onion', quantity: 1, unit: null, label: null },
            ],
          },
        ],
      },
      page: 'a',
    }).fatal,
  ).toEqual(['recipe 1 ingredients[0] archive "1 onion" ≠ v3 "1 large onion"'])
})

test('re-chunked steps carrying the same prose stay advisory', () => {
  const twoSentences = { ...recipe, steps: ['Peel it.', 'Cook it!'] }
  const result = compareV3Extraction({
    baseline: { recipes: [twoSentences] },
    candidate: {
      recipes: [
        {
          ...twoSentences,
          ingredientsInferred: false,
          // Merged, and with the space French sets before `!` — neither changes the prose.
          steps: ['Peel it. Cook it !'],
        },
      ],
    },
    page: 'a',
  })
  expect(result.fatal).toEqual([])
  expect(result.advisory).toEqual([
    'recipe 1 steps re-chunked: archive 2, v3 1, same prose',
  ])
})

test('dropped prose is fatal even when the step count matches', () => {
  const twoSentences = { ...recipe, steps: ['Peel it.', 'Cook it.'] }
  expect(
    compareV3Extraction({
      baseline: { recipes: [twoSentences] },
      candidate: {
        recipes: [
          {
            ...twoSentences,
            ingredientsInferred: false,
            steps: ['Peel it.', 'Serve it.'],
          },
        ],
      },
      page: 'a',
    }).fatal,
  ).toEqual(['recipe 1 steps[1] archive "Cook it." ≠ v3 "Serve it."'])
})

test('on a page printing no list, the flag is fatal and the lines are advisory', () => {
  const inferred = {
    ...recipe,
    ingredientsInferred: true,
    ingredients: PAGE_E_EXPECTED_INGREDIENTS.map((raw) => ({
      raw,
      quantity: null,
      unit: null,
      label: null,
    })),
  }
  const drifted = compareV3Extraction({
    baseline: { recipes: [recipe] },
    candidate: { recipes: [{ ...inferred, ingredientsInferred: false }] },
    page: 'e',
  })
  expect(drifted.fatal).toEqual([
    'Soup: ingredientsInferred is false, the page prints no list',
  ])
  expect(drifted.advisory.length).toBeGreaterThan(0)
  // Page G has no hand transcription, so nothing about its lines can be fatal.
  expect(
    compareV3Extraction({
      baseline: { recipes: [recipe] },
      candidate: { recipes: [inferred] },
      page: 'g',
    }).fatal,
  ).toEqual([])
})
