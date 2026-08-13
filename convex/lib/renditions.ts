import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { deleteStoredBlob } from './blobs'

/** The two image slots a recipe can carry. Each has its own source blob and its own rendition. */
export type RenditionSlot = 'original' | 'beautified'

export type Rendition = NonNullable<Doc<'recipes'>['imageRendition']>

/**
 * A patch that writes one slot's rendition field. **The only place the slot-to-field mapping is
 * encoded on the write side** — every writer goes through `renditionPatch`, so there is one thing to
 * change rather than one per call site.
 *
 * The annotation is what makes it safe: a computed key (`{[FIELDS[slot]]: …}`) widens to
 * `Record<string, …>`, which `ctx.db.patch` accepts, so a mistyped field name compiles clean and only
 * fails once Convex validates the patch at runtime. Returning a literal against this type puts the
 * error back at compile time, where the rest of the recipe-write helpers already put theirs.
 */
export type RenditionPatch = Partial<
  Pick<Doc<'recipes'>, 'imageRendition' | 'beautifiedRendition'>
>

export function renditionPatch(
  slot: RenditionSlot,
  rendition: Rendition | undefined,
): RenditionPatch {
  return slot === 'original'
    ? { imageRendition: rendition }
    : { beautifiedRendition: rendition }
}

export function renditionOf(
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
): Rendition | undefined {
  return slot === 'original'
    ? recipe.imageRendition
    : recipe.beautifiedRendition
}

export function sourceOf(
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
): Id<'_storage'> | undefined {
  return slot === 'original'
    ? recipe.imageStorageId
    : recipe.beautifiedStorageId
}

/**
 * The derivative a rendition points at, but only when it still describes the blob the slot actually
 * holds. This is the compare-and-set that makes a missed cleanup harmless: a stale rendition reads
 * as absent, so the caller falls back to the source instead of serving the previous photo.
 */
export function usableDerivative(
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
): Extract<Rendition, { status: 'ready' }> | null {
  const rendition = renditionOf(recipe, slot)
  if (!rendition || rendition.status !== 'ready') return null
  return rendition.sourceStorageId === sourceOf(recipe, slot) ? rendition : null
}

/**
 * Destroys a slot's derivative and clears its field, returning the patch fragment to spread — the
 * same shape as `withIllustration`, so it composes with the patches that already exist.
 *
 * **Every mutation that removes or replaces a source blob must call this.** Without it the
 * derivative outlives its source and becomes a blob nothing references, and the read path would keep
 * pointing at a photo that is gone.
 */
export async function clearRendition(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
): Promise<RenditionPatch> {
  const rendition = renditionOf(recipe, slot)
  if (rendition?.status === 'ready') {
    await deleteStoredBlob(ctx, rendition.storageId)
  }
  return renditionPatch(slot, undefined)
}

/** Both slots at once, for the paths that take a whole recipe down. */
export async function clearAllRenditions(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<RenditionPatch> {
  return {
    ...(await clearRendition(ctx, recipe, 'original')),
    ...(await clearRendition(ctx, recipe, 'beautified')),
  }
}
