import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { publishedRecipes } from './recipeCounts'

type RecipeFields = Omit<Doc<'recipes'>, '_id' | '_creationTime'>

/**
 * The three authorised ways to write the `recipes` table. Same discipline as `withSearchText` and
 * `restaged` in `lib/recipeWrites.ts`: the derived value has one writer.
 *
 * What is derived here is the counts aggregate, keyed on `(status, type)`. A write that changes either
 * without telling it is **irreparable**: `deleteIfExists` looks in the namespace the document names
 * *now*, so a status changed in silence leaves a phantom no later gesture can find. The inventory test
 * in `recipeCounts.test.ts` fails when a new export could reach those fields without coming through
 * here — it caught two such writes the day it was written.
 *
 * The pure derivations live in `lib/recipeWrites.ts`; these need a `MutationCtx`, so they live here,
 * next to it rather than inside the module that owns the aggregate.
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
  await publishedRecipes.insertIfDoesNotExist(ctx, await reread(ctx, recipeId))
  return recipeId
}

export async function patchRecipeDoc(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  patch: Partial<RecipeFields>,
): Promise<void> {
  await ctx.db.patch(recipe._id, patch)
  // `replaceOrInsert` across namespaces is what a publication is: the document leaves `review:plat`
  // and enters `published:plat`. Passing the pre-patch document is therefore load-bearing.
  await publishedRecipes.replaceOrInsert(
    ctx,
    recipe,
    await reread(ctx, recipe._id),
  )
}

export async function deleteRecipeDoc(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<void> {
  await ctx.db.delete(recipe._id)
  await publishedRecipes.deleteIfExists(ctx, recipe)
}

/**
 * The document as it stands inside this transaction, which the aggregate needs in order to place it.
 *
 * It throws rather than returning `null`, and that is the whole point of the helper: a read of a row
 * this transaction has just written cannot come back empty, and skipping the aggregate on an
 * impossible branch would produce the one failure this module exists to prevent — a count that drifts
 * with nothing to repair it. If the impossible happens, the transaction has to roll back.
 */
async function reread(
  ctx: MutationCtx,
  recipeId: Id<'recipes'>,
): Promise<Doc<'recipes'>> {
  const recipe = await ctx.db.get('recipes', recipeId)
  if (!recipe) {
    throw new Error(
      `Recette ${recipeId} illisible dans sa propre transaction : comptes non mis à jour`,
    )
  }
  return recipe
}
