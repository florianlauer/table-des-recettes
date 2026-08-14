import type { Id } from '../_generated/dataModel'
import { buildSearchText } from '../../src/lib/normalize'
import { stageOf } from '../../src/lib/illustrationStage'
import type { IllustrationStage } from '../../src/lib/illustrationStage'

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
 * `searchText`. All three keys are required rather than optional: a caller that forgot one would
 * silently file the recipe in the wrong bucket, and the whole point of the fields is that the index
 * can be trusted. A forgotten key is a compile error.
 *
 * This is what replaces querying `q.eq('hasIllustration', undefined)` — absence is not a value
 * Convex indexes, so the answer has to be stored.
 *
 * `at` is positional and not a member of `fields`: spread into the patch it would become a stray
 * `at` key, which the schema rejects.
 */
export function withIllustration<
  T extends {
    imageStorageId: Id<'_storage'> | undefined
    beautifiedAccepted: boolean
    noPhotoAvailable: boolean
  },
>(
  fields: T,
  at: number,
): T & {
  hasIllustration: boolean
  illustrationStage: IllustrationStage
  illustrationUpdatedAt: number
} {
  return {
    ...fields,
    hasIllustration: fields.imageStorageId !== undefined,
    illustrationStage: stageOf(fields),
    illustrationUpdatedAt: at,
  }
}

/**
 * For the writes that move a recipe between sections without changing its stage. `beautifyStatus` is
 * the second key of the work index, so a recipe coming back from arbitration changes section while
 * its stage stands still — and without this it would land at the bottom of a capped section, at the
 * date its photo was attached.
 */
export function touchedIllustration(at: number): {
  illustrationUpdatedAt: number
} {
  return { illustrationUpdatedAt: at }
}

/**
 * The compare-and-set token of the correction form. Optional in the schema because the recipes that
 * predate it were never backfilled; a document without one is at revision zero, and the fallback
 * lives here so that reading is not four places deciding the same thing.
 */
export function revisionOf(recipe: { revision?: number }): number {
  return recipe.revision ?? 0
}
