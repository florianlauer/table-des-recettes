import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import { ingredient, recipeType } from './schema'
import { compareBackupIds } from '../src/shared/backup-schema'

const nullableString = v.union(v.string(), v.null())
const nullableNumber = v.union(v.number(), v.null())

export const backupRecipe = v.object({
  id: v.string(),
  creationTime: v.number(),
  title: v.string(),
  type: recipeType,
  servings: nullableNumber,
  ingredients: v.array(
    v.object({
      raw: ingredient.fields.raw,
      quantity: nullableNumber,
      unit: nullableString,
      label: nullableString,
    }),
  ),
  ingredientsInferred: v.boolean(),
  steps: v.array(v.string()),
  status: v.union(v.literal('review'), v.literal('published')),
  slug: nullableString,
  publishedAt: nullableNumber,
  imageStorageId: nullableString,
  beautifiedStorageId: nullableString,
})

export const backupPayload = internalQuery({
  args: {},
  returns: v.array(backupRecipe),
  handler: async (ctx) => {
    const recipes = await ctx.db.query('recipes').collect()
    return recipes
      .sort((left, right) => compareBackupIds(left._id, right._id))
      .map((recipe) => ({
        id: recipe._id,
        creationTime: recipe._creationTime,
        title: recipe.title,
        type: recipe.type,
        servings: recipe.servings ?? null,
        ingredients: recipe.ingredients.map(
          ({ raw, quantity, unit, label }) => ({
            raw,
            quantity: quantity ?? null,
            unit: unit ?? null,
            label: label ?? null,
          }),
        ),
        ingredientsInferred: recipe.ingredientsInferred,
        steps: recipe.steps,
        status: recipe.status,
        slug: recipe.slug ?? null,
        publishedAt: recipe.publishedAt ?? null,
        imageStorageId: recipe.imageStorageId ?? null,
        beautifiedStorageId: recipe.beautifiedStorageId ?? null,
      }))
  },
})
