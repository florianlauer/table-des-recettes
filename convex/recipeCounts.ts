import { TableAggregate } from '@convex-dev/aggregate'
import { components } from './_generated/api'
import type { DataModel, Doc } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import type { RecipeType } from '../src/lib/recipeTypes'

type RecipeStatus = Doc<'recipes'>['status']

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
export function namespaceOf(status: RecipeStatus, type: RecipeType): string {
  return `${status}:${type}`
}

/**
 * Written only through `recipeDocs.ts`, which owns the three authorised writes of the table. This
 * module owns the index and the read and stops there: "how is a recipe written" has one answer, and it
 * is not filed under "counts".
 */
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
