import { TableAggregate } from '@convex-dev/aggregate'
import { components } from './_generated/api'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import type { RecipeType } from '../src/lib/recipeTypes'

type RecipeStatus = Doc<'recipes'>['status']
type RecipeFields = Omit<Doc<'recipes'>, '_id' | '_creationTime'>

export type TypeCounts = {
  total: number
  byType: Record<RecipeType, number>
}

/**
 * One namespace per (status, type) pair, and no sort key at all.
 *
 * The alternative — one namespace per status, `type` as the key — needs a bounded read per type, and
 * the component's own documentation is explicit that adjacent keys share internal nodes: every
 * published recipe would sit in one structure, so publishing anything would invalidate every count.
 * Twelve tiny independent structures instead (six types × two statuses), each read with no bounds.
 * `countBatch` still fetches them in a single round trip, so the cost is one query either way.
 */
function namespaceOf(status: RecipeStatus, type: RecipeType): string {
  return `${status}:${type}`
}

export const publishedRecipes = new TableAggregate<{
  Namespace: string
  Key: null
  DataModel: DataModel
  TableName: 'recipes'
}>(components.publishedRecipes, {
  namespace: (doc) => namespaceOf(doc.status, doc.type),
  sortKey: () => null,
})

/**
 * What the storefront's filter row needs, in one round trip and without reading a recipe.
 *
 * Exhaustive over the closed union, like the scan it replaces: a type with no match counts 0, it does
 * not vanish from the shape.
 */
export async function countPublishedByType(ctx: QueryCtx): Promise<TypeCounts> {
  const counts = await publishedRecipes.countBatch(
    ctx,
    RECIPE_TYPES.map((type) => ({ namespace: namespaceOf('published', type) })),
  )
  const byType = Object.fromEntries(
    RECIPE_TYPES.map((type, index) => [type, counts[index] ?? 0]),
  ) as Record<RecipeType, number>
  return { total: counts.reduce((sum, count) => sum + count, 0), byType }
}

/**
 * The three authorised ways to write the `recipes` table when `status` or `type` may change — the two
 * fields the aggregate is keyed on. Same discipline as `withSearchText` and `withIllustration`: the
 * derived value has one writer, and the inventory test in `recipes.test.ts` fails when a new export
 * could reach these fields without coming through here.
 *
 * The idempotent variants (`insertIfDoesNotExist` rather than `insert`) are permanent, not a migration
 * scaffold. The backfill runs at deploy time, so between a code push and its last batch the aggregate
 * is legitimately out of sync with the table; the strict variants would throw on exactly the writes
 * that happen in that window.
 */
export async function insertRecipeDoc(
  ctx: MutationCtx,
  fields: RecipeFields,
): Promise<Id<'recipes'>> {
  const recipeId = await ctx.db.insert('recipes', fields)
  const inserted = await ctx.db.get('recipes', recipeId)
  if (inserted) await publishedRecipes.insertIfDoesNotExist(ctx, inserted)
  return recipeId
}

export async function patchRecipeDoc(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  patch: Partial<RecipeFields>,
): Promise<void> {
  await ctx.db.patch(recipe._id, patch)
  const updated = await ctx.db.get('recipes', recipe._id)
  // `replaceOrInsert` across namespaces is what a publication is: the document leaves `review:plat`
  // and enters `published:plat`. Passing the pre-patch document is therefore load-bearing.
  if (updated) await publishedRecipes.replaceOrInsert(ctx, recipe, updated)
}

export async function deleteRecipeDoc(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<void> {
  await ctx.db.delete(recipe._id)
  await publishedRecipes.deleteIfExists(ctx, recipe)
}
