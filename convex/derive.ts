'use node'

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'
import { renditionSlot } from './derivations'

/**
 * Two display boxes, one derivative. The index box is 112px tall (96px under 640px) and 400 covers it
 * at any device pixel ratio it will meet. The recipe page is what actually sizes this number: the
 * photo there opens to the width of its column, capped at its own pixels, so the derivative's height
 * *is* the largest that page can show — see `DESIGN.md` § Hétérogénéité des photos, amendement du
 * 2026-08-13. Raising it would sharpen a 2× recipe page and cost every index row its bytes; that
 * trade needs a width-based `srcset`, not a bigger single file.
 */
export const DERIVATIVE_HEIGHT = 400
export const DERIVATIVE_QUALITY = 75

/**
 * Sharp is imported inside the handler, never at module scope, and this must not be "simplified".
 * `vitest.config.ts` sets `environment: 'edge-runtime'` globally and `convex-test` loads every
 * module under `convex/` through `import.meta.glob`. A top-level `import sharp from 'sharp'` would
 * therefore fail to load this file in *every* Convex test, not only in its own. A dynamic import is
 * also the mechanism `node.externalPackages` relies on, so it is what the deployed runtime expects.
 */
async function loadSharp() {
  const { default: sharp } = await import('sharp')
  return sharp
}

/** EXIF orientations 5 to 8 transpose the image, so its displayed size is the header's, swapped. */
function isTransposed(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8
}

/**
 * Renders one slot's display derivative and hands it to the finalising mutation.
 *
 * Everything runs under a single `try`: an action that dies without saying so leaves a state
 * indistinguishable from "never attempted", which is precisely the distinction the admin work list
 * depends on. On failure the blob it may already have stored is destroyed, and `failDerivation`
 * records the cause.
 */
export const deriveRendition = internalAction({
  args: {
    recipeId: v.id('recipes'),
    slot: renditionSlot,
    sourceStorageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, { recipeId, slot, sourceStorageId }) => {
    let stored: Id<'_storage'> | null = null
    try {
      const blob = await ctx.storage.get(sourceStorageId)
      if (!blob) throw new Error('Image source introuvable')

      const sharp = await loadSharp()
      const bytes = Buffer.from(await blob.arrayBuffer())

      // Source dimensions come from sharp and are **oriented**: `sniffImageHeader()` would return
      // the encoded ones, so an EXIF-6 source would be persisted 10×20 for a 20×10 display, which
      // distorts the layout instead of merely failing to reserve it.
      const metadata = await sharp(bytes).metadata()
      if (!metadata.width || !metadata.height) {
        throw new Error('Dimensions de la source illisibles')
      }
      const transposed = isTransposed(metadata.orientation)
      const sourceWidth = transposed ? metadata.height : metadata.width
      const sourceHeight = transposed ? metadata.width : metadata.height

      // `.rotate()` with no argument applies the EXIF orientation and then drops it.
      // `withoutEnlargement` keeps a source smaller than the box from being blown up.
      const { data, info } = await sharp(bytes)
        .rotate()
        .resize({ height: DERIVATIVE_HEIGHT, withoutEnlargement: true })
        .webp({ quality: DERIVATIVE_QUALITY })
        .toBuffer({ resolveWithObject: true })

      stored = await ctx.storage.store(
        new Blob([new Uint8Array(data)], { type: 'image/webp' }),
      )

      await ctx.runMutation(internal.derivations.finalizeDerivation, {
        recipeId,
        slot,
        sourceStorageId,
        storageId: stored,
        sourceWidth,
        sourceHeight,
        // Output dimensions, read from `info` and never from `metadata()`: the latter describes the
        // input and ignores `.rotate()`.
        width: info.width,
        height: info.height,
      })
    } catch (error) {
      // The store-then-mutate window cannot be closed — a mutation cannot write bytes — so this
      // covers every *interceptable* failure. A hard kill still leaves a residual window.
      if (stored) await ctx.storage.delete(stored)
      await ctx.runMutation(internal.derivations.failDerivation, {
        recipeId,
        slot,
        sourceStorageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  },
})

// Deriving every slot that has a blob and no derivative is `migrations.backfillRenditions`. It used to
// be a `deriveMissing` action here, driven by a human repeating it until it reported zero, and its own
// comment justified the hand-roll by the cost of "a resumable batched migration" — a cost
// `@convex-dev/migrations` removes. `listPendingDerivations` stays: a bounded read that answers "is
// anything left", which is not the same thing as a loop.
