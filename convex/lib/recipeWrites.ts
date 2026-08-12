import type { Id } from '../_generated/dataModel'
import { buildSearchText } from '../../src/lib/normalize'

/**
 * The only authorised entry point for writing the (title, ingredients) pair.
 * Always derives `searchText`: never insert or patch without going through here.
 */
export function withSearchText<
  T extends { title: string; ingredients: readonly { raw: string }[] },
>(fields: T): T & { searchText: string } {
  return {
    ...fields,
    searchText: buildSearchText(fields.title, fields.ingredients),
  }
}

/**
 * The only authorised entry point for writing `imageStorageId`, exactly as `withSearchText` governs
 * `searchText`. The key is required rather than optional: a caller that forgot it would silently
 * clear the flag, and the whole point of the field is that the index can be trusted.
 *
 * This is what replaces querying `q.eq('hasIllustration', undefined)` — absence is not a value
 * Convex indexes, so the answer has to be stored.
 */
export function withIllustration<
  T extends { imageStorageId: Id<'_storage'> | undefined },
>(fields: T): T & { hasIllustration: boolean } {
  return { ...fields, hasIllustration: fields.imageStorageId !== undefined }
}

/**
 * The compare-and-set token of the correction form. Optional in the schema because the recipes that
 * predate it were never backfilled; a document without one is at revision zero, and the fallback
 * lives here so that reading is not four places deciding the same thing.
 */
export function revisionOf(recipe: { revision?: number }): number {
  return recipe.revision ?? 0
}
