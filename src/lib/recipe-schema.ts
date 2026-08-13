import { z } from 'zod'
import { trimIngredientLine } from './ingredientLine.js'
import { RECIPE_TYPES } from './recipeTypes.js'
import { MAX_RECIPES_PER_SCAN } from './scanLimits.js'

export const RECIPE_SCHEMA_VERSION = '2'

export const recipeTypeSchema = z.enum(RECIPE_TYPES)

export const ingredientSchema = z.strictObject({
  raw: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  label: z.string().nullable(),
})

export const recipeSchemaV1 = z.strictObject({
  title: z.string(),
  type: recipeTypeSchema,
  servings: z.number().nullable(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(z.string()),
})

export const extractionSchemaV1 = z.strictObject({
  recipes: z.array(recipeSchemaV1),
})

export const recipeSchema = recipeSchemaV1.extend({
  ingredientsInferred: z.boolean(),
})

// The bound lives here rather than in a downstream check: past it `safeParse` fails and the flow
// already reports `invalid_schema` with the raw answer kept for diagnosis, so a second guard in
// `finalize` would be unreachable.
export const extractionSchemaV2 = z.strictObject({
  recipes: z.array(recipeSchema).max(MAX_RECIPES_PER_SCAN),
})

export const extractionSchema = extractionSchemaV2

export type Extraction = z.infer<typeof extractionSchema>

export type SchemaRepair = { path: string; from: string; to: number | null }

// `strict: true` n'est pas contraignant sur OpenRouter : gemini-2.5-flash-lite a rendu
// « 6 à 8 personnes » dans un champ déclaré `number`, chez google-ai-studio comme chez
// google-vertex. La réparation ne couvre que ce cas — une chaîne dans un champ numérique — et
// n'invente rien : sans nombre en tête, la valeur devient null au lieu d'être devinée.
function repairNumber(
  value: unknown,
): { value: number | null; from: string } | null {
  if (typeof value !== 'string') return null
  const leading = /^\s*(\d+(?:[.,]\d+)?)/.exec(value)
  return {
    value: leading?.[1] ? Number(leading[1].replace(',', '.')) : null,
    from: value,
  }
}

export function repairExtraction(input: unknown): {
  value: unknown
  repairs: SchemaRepair[]
} {
  const repairs: SchemaRepair[] = []
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray((input as { recipes?: unknown }).recipes)
  ) {
    return { value: input, repairs }
  }

  const recipes = (input as { recipes: unknown[] }).recipes.map(
    (recipe, recipeIndex) => {
      if (!recipe || typeof recipe !== 'object') return recipe
      const repaired = { ...(recipe as Record<string, unknown>) }

      const servings = repairNumber(repaired.servings)
      if (servings) {
        repairs.push({
          path: `recipes.${recipeIndex}.servings`,
          from: servings.from,
          to: servings.value,
        })
        repaired.servings = servings.value
      }

      if (Array.isArray(repaired.ingredients)) {
        repaired.ingredients = repaired.ingredients.map(
          (ingredient, ingredientIndex) => {
            if (!ingredient || typeof ingredient !== 'object') return ingredient
            const line = { ...(ingredient as Record<string, unknown>) }
            const quantity = repairNumber(line.quantity)
            if (quantity) {
              repairs.push({
                path: `recipes.${recipeIndex}.ingredients.${ingredientIndex}.quantity`,
                from: quantity.from,
                to: quantity.value,
              })
              line.quantity = quantity.value
            }
            return line
          },
        )
      }

      return repaired
    },
  )

  return { value: { ...(input as Record<string, unknown>), recipes }, repairs }
}

export type DomainExtraction = {
  recipes: Array<{
    title: string
    type: z.infer<typeof recipeTypeSchema>
    servings: number | undefined
    ingredients: Array<{
      raw: string
      quantity: number | undefined
      unit: string | undefined
      label: string | undefined
    }>
    ingredientsInferred: boolean
    steps: string[]
  }>
}

export function normalizeExtraction(extraction: Extraction): DomainExtraction {
  return {
    recipes: extraction.recipes.map(
      ({ title, type, servings, ingredients, ingredientsInferred, steps }) => ({
        title,
        type,
        servings: servings ?? undefined,
        ingredients: ingredients.map(({ raw, quantity, unit, label }) => ({
          raw: trimIngredientLine(raw),
          quantity: quantity ?? undefined,
          unit: unit ?? undefined,
          label: label ? trimIngredientLine(label) || undefined : undefined,
        })),
        ingredientsInferred,
        steps,
      }),
    ),
  }
}
