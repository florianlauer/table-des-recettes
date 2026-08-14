import { Workpool } from '@convex-dev/workpool'
import { v } from 'convex/values'
import { components } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery } from './_generated/server'
import { deleteStoredBlob } from './lib/blobs'
import {
  renditionOf,
  renditionPatch,
  sourceOf,
  usableDerivative,
} from './lib/renditions'
import type { RenditionSlot } from './lib/renditions'
import { literalUnion } from './lib/validators'

export const renditionSlot = literalUnion(['original', 'beautified'] as const)

/**
 * How many derivations run at once. Every job loads sharp and a full-size image into a Node action,
 * so the bound is about memory and not about politeness: the backfill enumerates the whole corpus, and
 * `scheduler.runAfter(0, …)` would start all of them at once — the scheduler has no ceiling.
 *
 * Four, not one: a single-file queue makes a batch of twenty photos take twenty decodes end to end for
 * no reason, and four sharp instances is a size a Convex action holds without trouble.
 */
export const RENDITION_PARALLELISM = 4

/**
 * The bound is only real if **every** call site goes through it. A pool the backfill uses and the
 * attach path bypasses would still let a burst of uploads fan out unbounded — three sites enqueue
 * here: the backfill migration, `commitIllustration`, and the branch of `finalizeBeautify` that adopts.
 *
 * No `retryActionsByDefault`: `deriveRendition` catches every failure itself and records it against a
 * per-source attempt budget (`MAX_DERIVATION_ATTEMPTS` below). It therefore never throws, so a pool
 * retry would never fire — and if it did, the two budgets would count the same failure twice.
 */
export const renditionPool = new Workpool(components.renditionWorkpool, {
  maxParallelism: RENDITION_PARALLELISM,
})

/** One page per pass. The corpus is a few hundred recipes; an unbounded scan has no ceiling. */
export const PENDING_SCAN_BATCH = 200

/**
 * How many times a source is tried before the backfill stops selecting it on its own. Three, because
 * the failures worth retrying are one-off — a native library that did not load, a transient storage
 * read — and an image that is genuinely undecodable fails identically every time. `retryFailed` still
 * reaches past this ceiling on demand.
 */
export const MAX_DERIVATION_ATTEMPTS = 3

const pendingSlot = v.object({
  recipeId: v.id('recipes'),
  slot: renditionSlot,
  sourceStorageId: v.id('_storage'),
})

/**
 * Adopts a freshly derived blob, or destroys it — in one transaction, so no crash can land between
 * "the recipe points at the derivative" and "the derivative exists".
 *
 * The staleness rule is the same one `finalizeBeautify` applies, for the same reason: the source may
 * have been replaced while the action was running, and a derivative made from the previous bytes
 * must not be adopted. Comparing `sourceStorageId` is what decides it.
 */
export const finalizeDerivation = internalMutation({
  args: {
    recipeId: v.id('recipes'),
    slot: renditionSlot,
    sourceStorageId: v.id('_storage'),
    storageId: v.id('_storage'),
    sourceWidth: v.number(),
    sourceHeight: v.number(),
    width: v.number(),
    height: v.number(),
  },
  returns: literalUnion(['adopted', 'discarded'] as const),
  handler: async (ctx, { recipeId, slot, sourceStorageId, ...derived }) => {
    const recipe = await ctx.db.get('recipes', recipeId)
    if (!recipe || sourceOf(recipe, slot) !== sourceStorageId) {
      await deleteStoredBlob(ctx, derived.storageId)
      return 'discarded'
    }

    // A replay of the same derivation: the rendition in place is already this one, so there is
    // nothing to write and nothing to destroy. Any *other* blob is a second run's and must go.
    const current = renditionOf(recipe, slot)
    if (current?.status === 'ready') {
      if (current.storageId === derived.storageId) return 'adopted'
      await deleteStoredBlob(ctx, current.storageId)
    }

    await ctx.db.patch(
      recipeId,
      renditionPatch(slot, {
        status: 'ready' as const,
        sourceStorageId,
        ...derived,
      }),
    )
    return 'adopted'
  },
})

/**
 * Records a derivation that could not be produced.
 *
 * It carries **the same** freshness guard as `finalizeDerivation`, and that is not symmetry for its
 * own sake: without it, a source replaced while sharp was failing would have its stale `failed`
 * written *after* the replacement cleared the slot. Reads would stay safe — the compare-and-set
 * protects them — but the admin work list would report a failure on a photo that no longer exists,
 * and the backfill would count phantom work.
 */
export const failDerivation = internalMutation({
  args: {
    recipeId: v.id('recipes'),
    slot: renditionSlot,
    sourceStorageId: v.id('_storage'),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { recipeId, slot, sourceStorageId, error }) => {
    const recipe = await ctx.db.get('recipes', recipeId)
    if (!recipe || sourceOf(recipe, slot) !== sourceStorageId) return false

    // A failure must never destroy a success. Two runs can overlap on the same slot — `commitIllustration`
    // schedules one while a backfill pass is selecting the same slot — and if the second one breaks
    // after the first has adopted its derivative, writing `failed` here would drop a working
    // derivative to an orphan blob and put the storefront back on the full-weight source, silently.
    if (usableDerivative(recipe, slot)) return false

    // Attempts accumulate across runs so the backfill can retry a transient failure and still
    // converge. Counted per source: replacing the photo starts the budget over.
    const previous = renditionOf(recipe, slot)
    const attempts =
      previous?.status === 'failed' &&
      previous.sourceStorageId === sourceStorageId
        ? previous.attempts + 1
        : 1

    await ctx.db.patch(
      recipeId,
      renditionPatch(slot, {
        status: 'failed' as const,
        sourceStorageId,
        error,
        attempts,
      }),
    )
    return true
  },
})

export function pendingSlotsOf(
  recipe: Doc<'recipes'>,
  retryFailed: boolean,
): { slot: RenditionSlot; sourceStorageId: Id<'_storage'> }[] {
  const slots: RenditionSlot[] = ['original', 'beautified']
  return slots.flatMap((slot) => {
    const sourceStorageId = sourceOf(recipe, slot)
    if (!sourceStorageId) return []
    if (usableDerivative(recipe, slot)) return []
    // A `failed` rendition is retried while it is under the attempt ceiling, then only on demand:
    // selecting it for ever would keep an undecodable image in the work set and "repeat until zero"
    // would never converge, while never selecting it at all would park a photo at full weight on a
    // failure that had nothing to do with its bytes.
    const rendition = renditionOf(recipe, slot)
    const exhausted =
      rendition?.status === 'failed' &&
      rendition.sourceStorageId === sourceStorageId &&
      rendition.attempts >= MAX_DERIVATION_ATTEMPTS
    if (exhausted && !retryFailed) return []
    return [{ slot, sourceStorageId }]
  })
}

/**
 * The slots a backfill pass should derive. **Both slots are enumerated, whichever one is on screen**:
 * an original hidden behind an accepted beautification is not displayed today, but unpublishing puts
 * it back — without a derivative, and therefore at full weight.
 *
 * An action has no `ctx.db`, so `derive.deriveMissing` reaches this through `ctx.runQuery`.
 */
export const listPendingDerivations = internalQuery({
  args: { limit: v.number(), retryFailed: v.optional(v.boolean()) },
  returns: v.object({
    slots: v.array(pendingSlot),
    // False when the walk stopped on `limit` rather than on the end of the corpus, so the caller
    // knows a further pass has something left to find.
    isDone: v.boolean(),
  }),
  handler: async (ctx, { limit, retryFailed }) => {
    // Paginated inside the query rather than driven by a cursor from the action: the corpus is a few
    // hundred rows, and walking it here keeps the backfill a single round trip.
    const slots: (typeof pendingSlot)['type'][] = []
    let cursor: string | null = null
    let reachedEnd = false
    // A page can reach the end of the corpus *and* drop pending slots over the limit in the same
    // pass, so "walked to the end" alone would report done while work remains.
    let truncated = false

    while (slots.length < limit) {
      const page = await ctx.db
        .query('recipes')
        .withIndex('by_illustration', (q) => q.eq('hasIllustration', true))
        .paginate({ cursor, numItems: PENDING_SCAN_BATCH })

      for (const recipe of page.page) {
        for (const pending of pendingSlotsOf(recipe, retryFailed ?? false)) {
          if (slots.length < limit) {
            slots.push({ recipeId: recipe._id, ...pending })
          } else {
            truncated = true
          }
        }
      }
      cursor = page.continueCursor
      if (page.isDone) {
        reachedEnd = true
        break
      }
    }

    return { slots, isDone: reachedEnd && !truncated }
  },
})
