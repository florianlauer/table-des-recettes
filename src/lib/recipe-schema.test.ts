import type { Infer } from 'convex/values'
import { describe, expect, test } from 'vitest'
import type { recipeType } from '../../convex/schema'
import { ingredient } from '../../convex/schema'
import {
  extractionSchema,
  extractionSchemaV1,
  extractionSchemaV2,
  ingredientSchema,
  normalizeExtraction,
} from './recipe-schema'
import type { RecipeType } from './recipeTypes'
import { MAX_RECIPES_PER_SCAN } from './scanLimits'

type Equal<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <
    TValue,
  >() => TValue extends TRight ? 1 : 2
    ? true
    : false
type Assert<TValue extends true> = TValue
type RecipeTypesStayAligned = Assert<
  Equal<Infer<typeof recipeType>, RecipeType>
>
const recipeTypesStayAligned: RecipeTypesStayAligned = true

describe('recipe schema versions', () => {
  const v1Recipe = {
    title: 'Soup',
    type: 'entree',
    servings: 4,
    ingredients: [{ raw: '1 onion', quantity: 1, unit: null, label: 'onion' }],
    steps: ['Cook.'],
  }

  test('keeps archived v1 payloads valid and requires the v2 signal', () => {
    expect(extractionSchemaV1.safeParse({ recipes: [v1Recipe] }).success).toBe(
      true,
    )
    expect(extractionSchemaV2.safeParse({ recipes: [v1Recipe] }).success).toBe(
      false,
    )
    expect(
      extractionSchemaV2.safeParse({
        recipes: [{ ...v1Recipe, ingredientsInferred: false }],
      }).success,
    ).toBe(true)
  })

  test('normalizes nullable model fields without losing the inference signal', () => {
    const parsed = extractionSchemaV2.parse({
      recipes: [{ ...v1Recipe, ingredientsInferred: true }],
    })
    expect(normalizeExtraction(parsed).recipes[0]).toMatchObject({
      ingredientsInferred: true,
      ingredients: [{ unit: undefined }],
    })
  })

  test('cleans the title on its way out of the extraction', () => {
    const parsed = extractionSchemaV2.parse({
      recipes: [
        {
          ...v1Recipe,
          title: '  NOIX DE SAINT-JACQUES A LA TAPENADE — ',
          ingredientsInferred: false,
        },
      ],
    })
    expect(normalizeExtraction(parsed).recipes[0]?.title).toBe(
      'Noix de saint-jacques a la tapenade',
    )
  })

  test('locks Zod nullable fields to Convex optional fields', () => {
    const zodKeys = Object.keys(ingredientSchema.shape).sort()
    const convexFields = (
      ingredient as unknown as {
        json: {
          value: Record<string, { optional: boolean }>
        }
      }
    ).json.value
    expect(Object.keys(convexFields).sort()).toEqual(zodKeys)
    expect(ingredientSchema.shape.raw.safeParse(null).success).toBe(false)
    expect(convexFields.raw?.optional).toBe(false)
    for (const key of ['quantity', 'unit', 'label'] as const) {
      expect(ingredientSchema.shape[key].safeParse(null).success).toBe(true)
      expect(convexFields[key]?.optional).toBe(true)
    }
    expect(recipeTypesStayAligned).toBe(true)
  })
})

describe('extraction bounds', () => {
  test('refuses an answer holding more recipes than a page can carry', () => {
    const recipe = {
      title: 'Recette',
      type: 'autre',
      servings: null,
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
    }
    const fits = { recipes: Array(MAX_RECIPES_PER_SCAN).fill(recipe) }
    const overflows = { recipes: Array(MAX_RECIPES_PER_SCAN + 1).fill(recipe) }

    expect(extractionSchema.safeParse(fits).success).toBe(true)
    // Rejected here rather than downstream: past this point `safeParse` fails and the flow already
    // reports `invalid_schema`, so a second guard in `finalize` would be unreachable.
    expect(extractionSchema.safeParse(overflows).success).toBe(false)
  })
})
