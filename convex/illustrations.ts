import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { deleteStoredBlob } from './lib/blobs'
import { findAttempt, settleAttempt } from './lib/beautifyJournal'
import { withIllustration } from './lib/recipeWrites'
import { literalUnion, okOrError, refuse, succeeded } from './lib/validators'
import type { Refusal } from './lib/validators'
import { rateLimiter } from './rateLimits'
import { beautifyStatus, recipeType } from './schema'
import { HAS_ILLUSTRATION_MIGRATION, readMigration } from './migrations'
import {
  BEAUTIFY_ATTEMPTS_SAMPLED,
  beautifySummary,
  summarizeBeautifyAttempts,
} from '../src/lib/beautifyStats'
import {
  configuredBeautifyIdentity,
  isCurrentBeautifyGroup,
} from '../src/lib/currentIdentity'
import { BEAUTIFY_LEASE_MS } from '../src/lib/illustrationWork'
import { IMAGE_HEADER_BYTES, sniffImageHeader } from '../src/lib/imageHeader'

export const ILLUSTRATION_WORK_LISTED = 50

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
 * A generation still running is cancelled whole, not half. Clearing only the attempt id — as an
 * earlier design did — left the recipe `generating` until a lease expired by hand: blocked, with
 * nothing on screen saying why.
 */
function withoutGeneration(recipe: Doc<'recipes'>, reason: string) {
  return recipe.beautifyStatus === 'generating'
    ? {
        beautifyStatus: 'failed' as const,
        beautifyError: reason,
        beautifyAttemptId: undefined,
        beautifyStartedAt: undefined,
      }
    : {
        beautifyStatus: 'idle' as const,
        beautifyError: undefined,
        beautifyAttemptId: undefined,
        beautifyStartedAt: undefined,
      }
}

/**
 * The original leaving takes the candidate with it. A candidate rendered from an image that no
 * longer exists cannot be compared against the one that replaced it — the arbitration screen would
 * be showing two pictures of different things and calling it a choice.
 */
async function dropCandidate(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<void> {
  if (!recipe.beautifiedStorageId) return
  await deleteStoredBlob(ctx, recipe.beautifiedStorageId)
  // Billed, destroyed, never judged. `rejected` would claim a verdict nobody gave; `discarded` is
  // the outcome that keeps the money counted and says no arbitration was possible.
  await settleAttempt(ctx, recipe.beautifyAttemptId, 'discarded')
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

    if (recipe.imageStorageId && recipe.imageStorageId !== storageId)
      await deleteStoredBlob(ctx, recipe.imageStorageId)
    await dropCandidate(ctx, recipe)
    await ctx.db.patch(recipeId, {
      ...withIllustration({ imageStorageId: storageId }),
      beautifiedStorageId: undefined,
      ...withoutGeneration(recipe, REPLACED_REASON),
    })
    await ctx.db.patch(ticketId, {
      consumedAt,
      storageId,
      recipeId,
      outcome: 'ok' as const,
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

  await deleteStoredBlob(ctx, recipe.imageStorageId)
  await dropCandidate(ctx, recipe)
  await ctx.db.patch(recipe._id, {
    ...withIllustration({ imageStorageId: undefined }),
    beautifiedStorageId: undefined,
    ...withoutGeneration(recipe, DETACHED_REASON),
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

  // No candidate blob survives a new generation. Without this, the one a de-publication kept was
  // silently overwritten by the next — one orphan per regeneration.
  await dropCandidate(ctx, recipe)

  const now = Date.now()
  const attemptId = `${recipe._id}:${now}`
  await ctx.db.patch(recipe._id, {
    beautifiedStorageId: undefined,
    beautifyStatus: 'generating',
    beautifyAttemptId: attemptId,
    beautifyStartedAt: now,
    beautifyError: undefined,
  })
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

  await settleAttempt(ctx, recipe.beautifyAttemptId, 'accepted')
  await ctx.db.patch(recipe._id, {
    beautifiedAccepted: true,
    beautifyStatus: 'idle',
    beautifyAttemptId: undefined,
  })
  return succeeded
})

export const rejectPendingCandidate = recipeMutation(async (ctx, recipe) => {
  const blocked = await arbitrable(ctx, recipe)
  if (blocked) return blocked

  await settleAttempt(ctx, recipe.beautifyAttemptId, 'rejected')
  await dropCandidate(ctx, recipe)
  await ctx.db.patch(recipe._id, {
    beautifiedStorageId: undefined,
    beautifyStatus: 'idle',
    beautifyAttemptId: undefined,
  })
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
    await ctx.db.patch(recipe._id, { beautifiedAccepted: false })
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

    await deleteStoredBlob(ctx, recipe.beautifiedStorageId)
    await ctx.db.patch(recipe._id, { beautifiedStorageId: undefined })
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

  await ctx.db.patch(recipe._id, {
    beautifyStatus: 'failed',
    beautifyError: 'Génération abandonnée à la main',
    beautifyAttemptId: undefined,
    beautifyStartedAt: undefined,
  })
  return succeeded
})

const illustrationRow = v.object({
  id: v.id('recipes'),
  title: v.string(),
  type: recipeType,
  status: literalUnion(['review', 'published'] as const),
  hasOriginal: v.boolean(),
  hasCandidate: v.boolean(),
  // The url can be null for a blob that exists — a signing hiccup, a race with a purge. The
  // booleans above are what the buttons read, so a missing url costs a picture, never a gesture.
  originalUrl: v.union(v.string(), v.null()),
  candidateUrl: v.union(v.string(), v.null()),
  beautifyStatus,
  beautifiedAccepted: v.boolean(),
  beautifyError: v.union(v.string(), v.null()),
  beautifyStartedAt: v.union(v.number(), v.null()),
})

async function toRow(ctx: QueryCtx, recipe: Doc<'recipes'>) {
  return {
    id: recipe._id,
    title: recipe.title,
    type: recipe.type,
    status: recipe.status,
    hasOriginal: recipe.imageStorageId !== undefined,
    hasCandidate: recipe.beautifiedStorageId !== undefined,
    originalUrl: recipe.imageStorageId
      ? await ctx.storage.getUrl(recipe.imageStorageId)
      : null,
    candidateUrl: recipe.beautifiedStorageId
      ? await ctx.storage.getUrl(recipe.beautifiedStorageId)
      : null,
    beautifyStatus: recipe.beautifyStatus,
    beautifiedAccepted: recipe.beautifiedAccepted,
    beautifyError: recipe.beautifyError ?? null,
    beautifyStartedAt: recipe.beautifyStartedAt ?? null,
  }
}

/** One over the cap, so a truncation is reported rather than silently shortening the work list. */
function bounded(rows: Doc<'recipes'>[]) {
  return {
    page: rows.slice(0, ILLUSTRATION_WORK_LISTED),
    truncated: rows.length > ILLUSTRATION_WORK_LISTED,
  }
}

export const listIllustrationWork = query({
  args: { adminToken: v.string(), includeIllustrated: v.boolean() },
  returns: v.object({
    active: v.array(illustrationRow),
    activeTruncated: v.boolean(),
    withoutIllustration: v.array(illustrationRow),
    withoutIllustrationTruncated: v.boolean(),
    illustrated: v.array(illustrationRow),
    illustratedTruncated: v.boolean(),
    // A single document read. Counting the whole table to derive "how many are off the index"
    // would be exactly the unbounded scan the batched backfill exists to avoid.
    migration: v.object({
      started: v.boolean(),
      done: v.boolean(),
      migrated: v.number(),
    }),
  }),
  handler: async (ctx, { adminToken, includeIllustrated }) => {
    requireAdmin(adminToken)
    const byStatus = (status: 'review' | 'generating' | 'failed') =>
      ctx.db
        .query('recipes')
        .withIndex('by_beautify_status', (q) => q.eq('beautifyStatus', status))
        .order('desc')
        .take(ILLUSTRATION_WORK_LISTED + 1)
    const byIllustration = (has: boolean) =>
      ctx.db
        .query('recipes')
        .withIndex('by_illustration', (q) => q.eq('hasIllustration', has))
        .order('desc')
        .take(ILLUSTRATION_WORK_LISTED + 1)

    const [review, generating, failed, without, illustrated, migration] =
      await Promise.all([
        byStatus('review'),
        byStatus('generating'),
        byStatus('failed'),
        byIllustration(false),
        includeIllustrated ? byIllustration(true) : Promise.resolve([]),
        readMigration(ctx, HAS_ILLUSTRATION_MIGRATION),
      ])

    // Waiting for arbitration first — it is work already paid for — then what is still running,
    // then what failed and can be relaunched.
    const active = bounded([...review, ...generating, ...failed])
    const missing = bounded(without)
    const done = bounded(illustrated)

    return {
      active: await Promise.all(active.page.map((row) => toRow(ctx, row))),
      activeTruncated: active.truncated,
      withoutIllustration: await Promise.all(
        missing.page.map((row) => toRow(ctx, row)),
      ),
      withoutIllustrationTruncated: missing.truncated,
      illustrated: await Promise.all(done.page.map((row) => toRow(ctx, row))),
      illustratedTruncated: done.truncated,
      migration: {
        started: migration !== null,
        done: migration?.done ?? false,
        migrated: migration?.migrated ?? 0,
      },
    }
  },
})

export const beautifyStats = query({
  args: { adminToken: v.string() },
  returns: v.array(beautifySummary),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const attempts = await ctx.db
      .query('beautifyAttempts')
      .withIndex('by_created_at')
      .order('desc')
      .take(BEAUTIFY_ATTEMPTS_SAMPLED)
    // Beautification pins no provider, so several served providers of the current model may be
    // marked; the screen averages them by call count.
    const identity = configuredBeautifyIdentity()
    return summarizeBeautifyAttempts(attempts).map((group) => ({
      ...group,
      isCurrent: isCurrentBeautifyGroup(group, identity),
    }))
  },
})
