import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action, internalMutation, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { renditionPool } from './derivations'
import { deleteStoredBlob } from './lib/blobs'
import { findAttempt } from './lib/beautifyJournal'
import { writeIllustration } from './lib/illustrationWrites'
import { okOrError, refuse, succeeded } from './lib/validators'
import type { Refusal } from './lib/validators'
import { rateLimiter } from './rateLimits'
import { BEAUTIFY_LEASE_MS } from '../src/lib/illustrationWork'
import { IMAGE_HEADER_BYTES, sniffImageHeader } from '../src/lib/imageHeader'

const REPLACED_REASON = 'Génération annulée : l’image source a été remplacée'
const DETACHED_REASON = 'Génération annulée : la photo a été retirée'

/**
 * Every gesture on this screen takes the same two arguments, answers the same way, and opens by
 * proving the same two things. Declared once so a new gesture inherits the guard instead of
 * rederiving it — and so the refusal on an unknown recipe cannot drift into seven wordings.
 */
function recipeMutation(
  handler: (
    ctx: MutationCtx,
    recipe: Doc<'recipes'>,
  ) => Promise<{ ok: true } | Refusal>,
) {
  return mutation({
    args: { adminToken: v.string(), recipeId: v.id('recipes') },
    returns: okOrError,
    handler: async (ctx, { adminToken, recipeId }) => {
      requireAdmin(adminToken)
      const recipe = await ctx.db.get('recipes', recipeId)
      return recipe ? handler(ctx, recipe) : refuse('Recette inconnue')
    },
  })
}

/**
 * Reads the bytes, which only an action can do: `ctx.storage.get` does not exist in a mutation.
 * Validation therefore happens here, and the ticket is consumed by the mutation below — inside a
 * transaction, or two concurrent uploads would both spend it.
 */
export const attachIllustration = action({
  args: {
    adminToken: v.string(),
    ticketId: v.id('uploadTickets'),
    storageId: v.id('_storage'),
    recipeId: v.id('recipes'),
  },
  returns: okOrError,
  handler: async (
    ctx,
    { adminToken, ticketId, storageId, recipeId },
  ): Promise<{ ok: true } | Refusal> => {
    requireAdmin(adminToken)
    const blob = await ctx.storage.get(storageId)
    // Nothing to delete, and no ticket consumed: the upload simply never landed.
    if (!blob) return refuse('Image téléversée introuvable')

    // Only the header is read. The bytes are never needed whole here, unlike an extraction, which
    // has to encode them for the model.
    const head = new Uint8Array(
      await blob.slice(0, IMAGE_HEADER_BYTES).arrayBuffer(),
    )
    const header = sniffImageHeader({ bytes: head, fileSize: blob.size })
    if (!header.ok) {
      // Deleted without reservation: no ticket has been consumed yet, so this blob belongs to
      // nobody and destroying it can take nothing from anyone.
      await ctx.storage.delete(storageId)
      return refuse(header.message)
    }
    return ctx.runMutation(internal.illustrations.commitIllustration, {
      ticketId,
      storageId,
      recipeId,
    })
  },
})

/**
 * Consumes the ticket and attaches, in one transaction.
 *
 * A refusal does **not** always delete. "Ticket already consumed, therefore delete the blob" is a
 * destructive race: a replay, or a second concurrent action, sees the ticket the first one spent
 * and deletes the image that first one just attached. Only a still-virgin ticket earns the right to
 * destroy; an exact replay is a success, and a divergent one refuses without touching anything.
 */
export const commitIllustration = internalMutation({
  args: {
    ticketId: v.id('uploadTickets'),
    storageId: v.id('_storage'),
    recipeId: v.id('recipes'),
  },
  returns: okOrError,
  handler: async (ctx, { ticketId, storageId, recipeId }) => {
    const ticket = await ctx.db.get('uploadTickets', ticketId)
    // Consumed tickets are swept after a week, so an unknown one may well be an old success. Never
    // destroy on this branch.
    if (!ticket) return refuse('Ticket de téléversement inconnu')

    if (ticket.consumedAt !== undefined) {
      if (
        ticket.outcome === 'ok' &&
        ticket.storageId === storageId &&
        ticket.recipeId === recipeId
      )
        return succeeded
      if (ticket.storageId !== storageId || ticket.recipeId !== recipeId)
        return refuse('Ticket déjà utilisé pour une autre photo')
      return refuse(ticket.error ?? 'Téléversement refusé')
    }

    const consumedAt = Date.now()
    const reject = async (error: string) => {
      await deleteStoredBlob(ctx, storageId)
      await ctx.db.patch(ticketId, {
        consumedAt,
        storageId,
        outcome: 'rejected' as const,
        error,
      })
      return refuse(error)
    }

    if ((ticket.purpose ?? 'scan') !== 'illustration')
      return reject('Ce ticket est réservé aux pages de scan')
    const recipe = await ctx.db.get('recipes', recipeId)
    if (!recipe) return reject('Recette inconnue')
    if (recipe.beautifiedAccepted)
      return reject(
        'Un embellissement est publié sur cette recette : dépublie-le avant de remplacer la photo',
      )

    await writeIllustration(ctx, recipe, {
      photo: { attach: storageId },
      generation: { cancel: REPLACED_REASON },
    })
    await ctx.db.patch(ticketId, {
      consumedAt,
      storageId,
      recipeId,
      outcome: 'ok' as const,
    })
    // The new photo has no derivative yet, so the storefront serves it at full weight until this
    // lands. Enqueued from here rather than from the action above: the ticket is spent inside this
    // transaction, so this is the first point where the attachment is certain.
    await renditionPool.enqueueAction(ctx, internal.derive.deriveRendition, {
      recipeId,
      slot: 'original',
      sourceStorageId: storageId,
    })
    return succeeded
  },
})

export const detachIllustration = recipeMutation(async (ctx, recipe) => {
  if (recipe.beautifiedAccepted)
    return refuse(
      'Un embellissement est publié sur cette recette : dépublie-le avant de retirer la photo',
    )
  if (!recipe.imageStorageId) return refuse('Cette recette n’a pas de photo')

  // Detaching does not force the flag, it reads it off the document: a recipe whose photo is removed
  // goes back to `missing`, and only one that already carried the flag goes back to `source-has-none`.
  await writeIllustration(ctx, recipe, {
    photo: 'detach',
    generation: { cancel: DETACHED_REASON },
  })
  return succeeded
})

/**
 * The transition matrix, applied. Each refusal names the gesture that would unblock it: a button
 * that greys out without a reason is a bug report waiting to happen.
 */
export const requestBeautify = recipeMutation(async (ctx, recipe) => {
  const sourceStorageId = recipe.imageStorageId
  if (!sourceStorageId)
    return refuse('Pose d’abord une photo sur cette recette')
  if (recipe.beautifiedAccepted)
    return refuse(
      'Dépublie l’embellissement accepté avant d’en générer un autre',
    )
  if (recipe.beautifyStatus === 'generating')
    return refuse('Une génération est déjà en cours sur cette recette')
  if (recipe.beautifyStatus === 'review')
    return refuse('Arbitre le candidat en attente avant d’en générer un autre')

  const limit = await rateLimiter.limit(ctx, 'beautify')
  if (!limit.ok)
    return refuse(
      `Trop de générations lancées : réessaie dans ${Math.ceil(limit.retryAfter / 1000)} s`,
    )

  const now = Date.now()
  const attemptId = `${recipe._id}:${now}`
  await writeIllustration(
    ctx,
    recipe,
    {
      // No candidate blob survives a new generation. Without this, the one a de-publication kept was
      // silently overwritten by the next — one orphan per regeneration.
      candidate: 'drop',
      // Leaves "À embellir" for "À arbitrer": the section changes even though the stage does not.
      generation: { start: attemptId },
    },
    now,
  )
  await ctx.scheduler.runAfter(0, internal.beautify.render, {
    recipeId: recipe._id,
    attemptId,
    // Carried rather than re-read: it is the image the render actually saw, and finalisation
    // compares against it.
    sourceStorageId,
  })
  return succeeded
})

export const acceptBeautified = recipeMutation(async (ctx, recipe) => {
  const blocked = await arbitrable(ctx, recipe)
  if (blocked) return blocked

  await writeIllustration(ctx, recipe, { arbitrate: 'accepted' })
  return succeeded
})

export const rejectPendingCandidate = recipeMutation(async (ctx, recipe) => {
  const blocked = await arbitrable(ctx, recipe)
  if (blocked) return blocked

  await writeIllustration(ctx, recipe, { arbitrate: 'rejected' })
  return succeeded
})

/**
 * Reserved to `review`, the only state where an attempt is still `pending` — and therefore the only
 * one where a judgement is still owed. A candidate kept after a de-publication is not arbitrable:
 * its attempt reads `accepted`, for good, and rewriting that would be a second arbitration.
 */
async function arbitrable(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
): Promise<Refusal | null> {
  if (recipe.beautifyStatus !== 'review')
    return refuse('Aucun candidat en attente d’arbitrage sur cette recette')
  // `review` without an attempt is a state nothing produces: finalisation is the only writer of that
  // status and it always keeps the id. Judging one anyway would settle a render whose billed cost
  // has no row to be attributed to — and the attempt id is cleared precisely *by* arbitration, so
  // its absence is the mark of a verdict already given.
  if (!recipe.beautifyAttemptId)
    return refuse('Cette génération a déjà été arbitrée')
  const attempt = await findAttempt(ctx, recipe.beautifyAttemptId)
  return attempt && attempt.outcome !== 'pending'
    ? refuse('Cette génération a déjà été arbitrée')
    : null
}

/** The blob survives: the storefront falls back to the original without losing a paid render. */
export const unpublishAcceptedCandidate = recipeMutation(
  async (ctx, recipe) => {
    if (!recipe.beautifiedAccepted)
      return refuse('Aucun embellissement publié sur cette recette')
    // The attempt's outcome is untouched: it records what the human thought of the render, not what
    // is on the storefront today.
    await writeIllustration(ctx, recipe, { unpublish: true })
    return succeeded
  },
)

/** Housekeeping, not arbitration — which is why it is a fifth gesture and not a fourth. */
export const deleteUnpublishedCandidate = recipeMutation(
  async (ctx, recipe) => {
    if (recipe.beautifiedAccepted)
      return refuse('Dépublie l’embellissement avant de le supprimer')
    if (recipe.beautifyStatus !== 'idle' || !recipe.beautifiedStorageId)
      return refuse('Aucun candidat conservé à supprimer')

    // The section does not change, but the photo situation does — and the rule is stated on the five
    // fields, not on the stage, so this one bumps too.
    await writeIllustration(ctx, recipe, { candidate: 'drop' })
    return succeeded
  },
)

/**
 * An action killed before its failure mutation leaves the recipe `generating` for ever. Manual, and
 * not a cron: the project refuses automatic surveillance, and `beautifyStartedAt` is what makes the
 * abandonment visible enough to be pressed.
 */
export const abandonBeautify = recipeMutation(async (ctx, recipe) => {
  if (recipe.beautifyStatus !== 'generating')
    return refuse('Aucune génération en cours sur cette recette')
  if (Date.now() - (recipe.beautifyStartedAt ?? 0) < BEAUTIFY_LEASE_MS)
    return refuse('Cette génération vient d’être lancée : laisse-lui le temps')

  await writeIllustration(ctx, recipe, {
    generation: { failed: 'Génération abandonnée à la main' },
  })
  return succeeded
})

/**
 * The operator's own statement about the source: this recipe has no photo in the book, stop offering
 * it. Admin-only — the storefront row of a recipe without a photo is already normal and complete.
 */
export const markNoPhotoAvailable = recipeMutation(async (ctx, recipe) => {
  if (recipe.imageStorageId)
    return refuse(
      'Cette recette a déjà une photo : retire-la avant de dire que la source n’en a pas',
    )
  if (recipe.noPhotoAvailable) return refuse('Cette recette est déjà marquée')

  await writeIllustration(ctx, recipe, { noPhotoAvailable: true })
  return succeeded
})

export const clearNoPhotoAvailable = recipeMutation(async (ctx, recipe) => {
  if (!recipe.noPhotoAvailable)
    return refuse(
      'Cette recette n’est pas marquée « sans photo dans la source »',
    )

  await writeIllustration(ctx, recipe, { noPhotoAvailable: false })
  return succeeded
})
