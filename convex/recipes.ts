import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import { query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { ingredient, recipeType } from './schema'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import { toSearchQuery } from '../src/lib/normalize'
import { findMatchingIngredient } from '../src/lib/matchReason'
import { pickDisplayImage } from '../src/lib/displayImage'

type StorageCtx = Pick<QueryCtx, 'storage'>

/**
 * An index row. `matchedIngredient` answers "why is this row here": outside a search, or when
 * the title already explains it, the answer is `null`. The field is therefore always present —
 * which is what lets `browse` have a single shape. `slug` is required here — see ADR 0001.
 */
export const publishedRecipeRow = v.object({
  id: v.string(),
  title: v.string(),
  slug: v.string(),
  type: recipeType,
  imageUrl: v.union(v.string(), v.null()),
  matchedIngredient: v.union(v.string(), v.null()),
})

export type PublishedRecipeRow = Infer<typeof publishedRecipeRow>

export const publishedRecipe = v.object({
  ...publishedRecipeRow.fields,
  servings: v.union(v.number(), v.null()),
  ingredients: v.array(ingredient),
  steps: v.array(v.string()),
})

/**
 * Spelled out by hand rather than derived from `RECIPE_TYPES`: the handler builds a
 * `Record<RecipeType, number>`, so a type added on one side and not the other breaks the
 * build. Drift is caught without making the validator unreadable.
 */
const typeCounts = v.object({
  total: v.number(),
  byType: v.object({
    entree: v.number(),
    plat: v.number(),
    dessert: v.number(),
    apero: v.number(),
    petitDej: v.number(),
    autre: v.number(),
  }),
})

async function imageUrl(
  ctx: StorageCtx,
  doc: Doc<'recipes'>,
): Promise<string | null> {
  const picked = pickDisplayImage({
    imageStorageId: doc.imageStorageId ?? null,
    beautifiedStorageId: doc.beautifiedStorageId ?? null,
    beautifiedAccepted: doc.beautifiedAccepted,
  })
  return picked ? ctx.storage.getUrl(picked.storageId) : null
}

/**
 * Crosses the draft → published boundary. A published recipe without a slug is a broken
 * invariant: we throw rather than manufacture a dead link (ADR 0001).
 */
async function toRow(
  ctx: StorageCtx,
  doc: Doc<'recipes'>,
  tokens: string,
): Promise<PublishedRecipeRow> {
  if (!doc.slug) {
    throw new Error(`Recette publiée sans slug : ${doc._id}`)
  }
  return {
    id: doc._id,
    title: doc.title,
    slug: doc.slug,
    type: doc.type,
    imageUrl: await imageUrl(ctx, doc),
    matchedIngredient: tokens
      ? findMatchingIngredient(doc.title, doc.ingredients, tokens)
      : null,
  }
}

/**
 * The single read behind the index. The list ↔ search switch lives here, on the side that owns
 * it: an empty query is not a separate mode, it is the absence of a text filter.
 */
export const browse = query({
  args: { query: v.optional(v.string()), type: v.optional(recipeType) },
  returns: v.array(publishedRecipeRow),
  handler: async (ctx, { query: rawQuery, type }) => {
    const tokens = toSearchQuery(rawQuery ?? '')

    const docs = tokens
      ? await ctx.db
          .query('recipes')
          .withSearchIndex('search_recipes', (s) => {
            const base = s
              .search('searchText', tokens)
              .eq('status', 'published')
            return type ? base.eq('type', type) : base
          })
          .take(1024)
      : await ctx.db
          .query('recipes')
          .withIndex('by_status_type', (q) => {
            const base = q.eq('status', 'published')
            return type ? base.eq('type', type) : base
          })
          .collect()

    return Promise.all(docs.map((doc) => toRow(ctx, doc, tokens)))
  },
})

/**
 * Counted over the same set the filters will act on. Called without a query it counts the shelf;
 * called with one it counts the matches, because a filter row advertising « Plats 42 » that clicks
 * through to two results describes a state that does not exist.
 *
 * The type is deliberately not an argument: the row has to show what *every* type would give, and
 * the active one is the caller's business.
 */
export const countsByType = query({
  args: { query: v.optional(v.string()) },
  returns: typeCounts,
  handler: async (ctx, { query: rawQuery }) => {
    const tokens = toSearchQuery(rawQuery ?? '')
    const rows = tokens
      ? await ctx.db
          .query('recipes')
          .withSearchIndex('search_recipes', (s) =>
            s.search('searchText', tokens).eq('status', 'published'),
          )
          // Same cap as `browse`, read the same way: two different ceilings would let the row
          // promise a count the list cannot produce.
          .take(1024)
      : await ctx.db
          .query('recipes')
          .withIndex('by_status_type', (q) => q.eq('status', 'published'))
          .collect()
    // Exhaustive over the closed union: a type with no match counts 0, it does not vanish
    // from the shape. The filter row therefore has nothing to guess.
    const byType = Object.fromEntries(
      RECIPE_TYPES.map((t) => [t, 0]),
    ) as Record<Doc<'recipes'>['type'], number>
    for (const row of rows) byType[row.type] += 1
    return { total: rows.length, byType }
  },
})

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publishedRecipe, v.null()),
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query('recipes')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!doc || doc.status !== 'published') return null
    // The output type only exposes what the storefront needs: the admin fields (scanId,
    // beautifyAttemptId, beautifyError) never reach the client.
    return {
      ...(await toRow(ctx, doc, '')),
      servings: doc.servings ?? null,
      ingredients: doc.ingredients,
      steps: doc.steps,
    }
  },
})
