import type { Id } from '../_generated/dataModel'
import { buildSearchText } from '../../src/shared/normalize'
import { stageOf } from '../../src/shared/illustrationStage'
import type { IllustrationStage } from '../../src/shared/illustrationStage'

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

/** The three fields the stage is a function of, and the three keys derived from them. */
type IllustrationFields = {
  imageStorageId: Id<'_storage'> | undefined
  beautifiedAccepted: boolean
  noPhotoAvailable: boolean
}

type IllustrationKeys = {
  hasIllustration: boolean
  illustrationStage: IllustrationStage
  illustrationUpdatedAt: number
}

/**
 * The derived keys alone. Everything that writes them goes through here, which is what replaces
 * querying `q.eq('hasIllustration', undefined)` — absence is not a value Convex indexes, so the answer
 * has to be stored.
 *
 * `at` is positional and not a member of `fields`: spread into a patch it would become a stray `at`
 * key, which the schema rejects.
 */
function derivedIllustration(
  fields: IllustrationFields,
  at: number,
): IllustrationKeys {
  return {
    hasIllustration: fields.imageStorageId !== undefined,
    illustrationStage: stageOf(fields),
    illustrationUpdatedAt: at,
  }
}

/**
 * The only authorised entry point for writing `imageStorageId` on an **insert**, exactly as
 * `withSearchText` governs `searchText`. All three keys are required rather than optional: a caller
 * that forgot one would silently file the recipe in the wrong bucket, and the whole point of the
 * fields is that the index can be trusted. A forgotten key is a compile error.
 *
 * For a patch on an existing recipe, use `restaged` below.
 */
export function withIllustration<T extends IllustrationFields>(
  fields: T,
  at: number,
): T & IllustrationKeys {
  return { ...fields, ...derivedIllustration(fields, at) }
}

/**
 * The same three keys, for a recipe that **already exists**: the base is the document, and the caller
 * names only what its gesture changes.
 *
 * `withIllustration` above is the shape for an insert, where the caller is building the fields anyway.
 * Restating all three on a patch is a different matter — it was five call sites repeating the document
 * back at itself, `noPhotoAvailable: recipe.noPhotoAvailable ?? false` included, to change one field.
 * The compile-time guarantee is stronger this way round, not weaker: with the document as the base
 * there is nothing left for a gesture to forget.
 *
 * The returned patch carries the change and the derived keys, and nothing else — a gesture does not
 * rewrite fields it never touched.
 */
export function restaged<TChange extends Partial<IllustrationFields>>(
  recipe: {
    imageStorageId?: Id<'_storage'>
    beautifiedAccepted: boolean
    noPhotoAvailable?: boolean
  },
  change: TChange,
  at: number,
): TChange & IllustrationKeys {
  return {
    ...change,
    ...derivedIllustration(
      {
        imageStorageId: recipe.imageStorageId,
        beautifiedAccepted: recipe.beautifiedAccepted,
        noPhotoAvailable: recipe.noPhotoAvailable ?? false,
        ...change,
      },
      at,
    ),
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
