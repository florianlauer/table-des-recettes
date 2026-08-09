import { z } from "zod";

export const RECIPE_SCHEMA_VERSION = "1";

export const recipeTypeSchema = z.enum([
  "entree",
  "plat",
  "dessert",
  "apero",
  "petitDej",
  "autre",
]);

export const ingredientSchema = z.strictObject({
  raw: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  label: z.string().nullable(),
});

export const recipeSchema = z.strictObject({
  title: z.string(),
  type: recipeTypeSchema,
  servings: z.number().nullable(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(z.string()),
});

export const extractionSchema = z.strictObject({
  recipes: z.array(recipeSchema),
});

export type Extraction = z.infer<typeof extractionSchema>;

export type DomainExtraction = {
  recipes: Array<{
    title: string;
    type: z.infer<typeof recipeTypeSchema>;
    servings: number | undefined;
    ingredients: Array<{
      raw: string;
      quantity: number | undefined;
      unit: string | undefined;
      label: string | undefined;
    }>;
    steps: string[];
  }>;
};

export function normalizeExtraction(extraction: Extraction): DomainExtraction {
  return {
    recipes: extraction.recipes.map(({ title, type, servings, ingredients, steps }) => ({
      title,
      type,
      servings: servings ?? undefined,
      ingredients: ingredients.map(({ raw, quantity, unit, label }) => ({
        raw,
        quantity: quantity ?? undefined,
        unit: unit ?? undefined,
        label: label ?? undefined,
      })),
      steps,
    })),
  };
}
