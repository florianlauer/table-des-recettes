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
 * The compare-and-set token of the correction form. Optional in the schema because the recipes that
 * predate it were never backfilled; a document without one is at revision zero, and the fallback
 * lives here so that reading is not four places deciding the same thing.
 */
export function revisionOf(recipe: { revision?: number }): number {
  return recipe.revision ?? 0
}
