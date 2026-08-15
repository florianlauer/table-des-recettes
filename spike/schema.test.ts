import { describe, expect, it } from 'vitest'

import {
  extractionSchema,
  normalizeExtraction,
  repairExtraction,
} from '../src/shared/recipe-schema.js'
import { extractionJsonSchema } from './json-schema.js'

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjects)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (node.type === 'object') {
    const properties = node.properties as Record<string, unknown>
    expect(node.additionalProperties).toBe(false)
    expect(node.required).toEqual(Object.keys(properties))
  }
  Object.values(node).forEach(assertStrictObjects)
}

describe('extraction schema', () => {
  it('makes every object strict and every key required', () => {
    assertStrictObjects(extractionJsonSchema)
  })

  // Observed for real on 2026-08-09: gemini-2.5-flash-lite returned "6 à 8 personnes" in a field
  // declared `number`, at google-ai-studio and google-vertex alike. `strict: true` is not binding.
  it('repairs a numeric field returned as text, and reports every repair', () => {
    const { value, repairs } = repairExtraction({
      recipes: [
        {
          title: 'Dinde',
          type: 'plat',
          servings: '6 à 8 personnes',
          ingredients: [
            { raw: '2 filets', quantity: '2 filets', unit: null, label: null },
            { raw: 'sel', quantity: 'une pincée', unit: null, label: null },
          ],
          ingredientsInferred: false,
          steps: ['Cuire.'],
        },
      ],
    })

    expect(extractionSchema.safeParse(value).success).toBe(true)
    const recipe = (value as { recipes: Array<Record<string, any>> })
      .recipes[0]!
    expect(recipe.servings).toBe(6)
    expect(recipe.ingredients[0].quantity).toBe(2)
    // Aucun nombre en tête : la valeur devient null plutôt que d'être devinée.
    expect(recipe.ingredients[1].quantity).toBeNull()
    expect(repairs).toHaveLength(3)
    expect(repairs[0]).toEqual({
      path: 'recipes.0.servings',
      from: '6 à 8 personnes',
      to: 6,
    })
  })

  it('leaves a compliant extraction untouched and reports no repair', () => {
    const compliant = {
      recipes: [
        {
          title: 'Soupe',
          type: 'entree',
          servings: 4,
          ingredients: [
            { raw: '1 carotte', quantity: 1, unit: null, label: null },
          ],
          ingredientsInferred: false,
          steps: ['Cuire.'],
        },
      ],
    }
    const { value, repairs } = repairExtraction(compliant)
    expect(repairs).toEqual([])
    expect(extractionSchema.parse(value)).toEqual(compliant)
  })

  it('keeps non-guaranteed fields present but nullable', () => {
    const sample = {
      recipes: [
        {
          title: 'Soupe',
          type: 'entree',
          servings: 4,
          ingredients: [
            { raw: '1 carotte', quantity: 1, unit: null, label: null },
          ],
          ingredientsInferred: false,
          steps: ['Cuire.'],
        },
      ],
    }
    const parsed = extractionSchema.parse(sample)
    expect(
      extractionSchema.safeParse({
        recipes: [{ ...sample.recipes[0], servings: undefined }],
      }).success,
    ).toBe(false)
    expect(normalizeExtraction(parsed)).toEqual({
      recipes: [
        {
          title: 'Soupe',
          type: 'entree',
          servings: 4,
          ingredients: [
            {
              raw: '1 carotte',
              quantity: 1,
              unit: undefined,
              label: undefined,
            },
          ],
          ingredientsInferred: false,
          steps: ['Cuire.'],
        },
      ],
    })
    expect(
      extractionSchema.safeParse({
        recipes: [{ ...sample.recipes[0], servings: '4' }],
      }).success,
    ).toBe(false)
    expect(
      extractionSchema.safeParse({
        recipes: [
          {
            ...sample.recipes[0],
            ingredients: [
              { ...sample.recipes[0]!.ingredients[0], quantity: '1' },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })
})
