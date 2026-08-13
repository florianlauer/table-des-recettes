import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { deleteStoredBlob } from './blobs'

/** The two image slots a recipe can carry. Each has its own source blob and its own rendition. */
export type RenditionSlot = 'original' | 'beautified'

type Rendition = NonNullable<Doc<'recipes'>['imageRendition']>

const FIELDS = {
  original: { source: 'imageStorageId', rendition: 'imageRendition' },
  beautified: {
    source: 'beautifiedStorageId',
    rendition: 'beautifiedRendition',
  },
} as const

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
): Promise<Record<string, undefined>> {
  const rendition = renditionOf(recipe, slot)
  if (rendition?.status === 'ready') {
    await deleteStoredBlob(ctx, rendition.storageId)
  }
  return { [FIELDS[slot].rendition]: undefined }
}

/** Both slots at once, for the paths that take a whole recipe down. */
export async function clearAllRenditions(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<Record<string, undefined>> {
  return {
    ...(await clearRendition(ctx, recipe, 'original')),
    ...(await clearRendition(ctx, recipe, 'beautified')),
  }
}
