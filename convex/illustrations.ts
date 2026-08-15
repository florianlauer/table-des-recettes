import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action, internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { renditionPool } from './derivations'
import { deleteStoredBlob } from './lib/blobs'
import { findAttempt } from './lib/beautifyJournal'
import { writeIllustration } from './lib/illustrationWrites'
import { renditionOf, sourceOf, usableDerivative } from './lib/renditions'
import type { RenditionSlot } from './lib/renditions'
import { literalUnion, okOrError, refuse, succeeded } from './lib/validators'
import type { Refusal } from './lib/validators'
import { rateLimiter } from './rateLimits'
import { beautifyStatus, recipeType } from './schema'
import {
  illustrationStageStatus,
  readIllustrationStageStatus,
} from './migrations'
import {
  BEAUTIFY_ATTEMPTS_SAMPLED,
  beautifySummary,
  summarizeBeautifyAttempts,
} from '../src/shared/beautifyStats'
import { configuredBeautifyIdentity } from '../src/shared/currentIdentity'
import { markCurrent } from '../src/shared/journalStats'
import {
  ILLUSTRATION_WORK_LISTED,
  boundedLimit,
} from '../src/shared/illustrationLimits'
import type { IllustrationStage } from '../src/shared/illustrationStage'
import { BEAUTIFY_LEASE_MS } from '../src/shared/illustrationWork'
import { IMAGE_HEADER_BYTES, sniffImageHeader } from '../src/shared/imageHeader'

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

    await writeIllustration(
      ctx,
      recipe,
      { photo: { attach: storageId }, generation: { cancel: REPLACED_REASON } },
      Date.now(),
    )
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

  await writeIllustration(
    ctx,
    recipe,
    // Detaching does not force the flag, it reads it off the document: a recipe whose photo is
    // removed goes back to `missing`, and only one that already carried the flag goes back to
    // `source-has-none`.
    { photo: 'detach', generation: { cancel: DETACHED_REASON } },
    Date.now(),
  )
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

  await writeIllustration(ctx, recipe, { arbitrate: 'accepted' }, Date.now())
  return succeeded
})

export const rejectPendingCandidate = recipeMutation(async (ctx, recipe) => {
  const blocked = await arbitrable(ctx, recipe)
  if (blocked) return blocked

  // The one that is easiest to miss: the stage is unchanged — still an original, still no accepted
  // beautification — but the recipe re-enters "À embellir". The module bumps the date for it, which
  // is what keeps it from re-entering at the date its photo was attached — in a capped section,
  // nowhere.
  await writeIllustration(ctx, recipe, { arbitrate: 'rejected' }, Date.now())
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
    await writeIllustration(ctx, recipe, { unpublish: true }, Date.now())
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
    await writeIllustration(ctx, recipe, { candidate: 'drop' }, Date.now())
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

  await writeIllustration(
    ctx,
    recipe,
    { generation: { failed: 'Génération abandonnée à la main' } },
    Date.now(),
  )
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

  await writeIllustration(ctx, recipe, { noPhotoAvailable: true }, Date.now())
  return succeeded
})

export const clearNoPhotoAvailable = recipeMutation(async (ctx, recipe) => {
  if (!recipe.noPhotoAvailable)
    return refuse(
      'Cette recette n’est pas marquée « sans photo dans la source »',
    )

  await writeIllustration(ctx, recipe, { noPhotoAvailable: false }, Date.now())
  return succeeded
})

/**
 * What derivation has to say about one slot. Three states rather than a boolean, and one report per
 * slot rather than one per row: a row shows the original **and** the candidate, so a single state
 * could not say which of the two failed — nor carry the cause this screen promises to show.
 */
const renditionReport = v.union(
  v.object({
    state: literalUnion(['ready', 'absent'] as const),
    error: v.null(),
  }),
  v.object({ state: v.literal('failed'), error: v.string() }),
)

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
  // Null when the slot holds no blob at all, so there is nothing to say about it.
  originalRendition: v.union(renditionReport, v.null()),
  candidateRendition: v.union(renditionReport, v.null()),
  // Whether the urls above point at derivatives, which is what tells the client how large a box to
  // give them. The arbitration bucket says false, the inventory buckets say true.
  thumbnails: v.boolean(),
  beautifyStatus,
  beautifiedAccepted: v.boolean(),
  noPhotoAvailable: v.boolean(),
  beautifyError: v.union(v.string(), v.null()),
  beautifyStartedAt: v.union(v.number(), v.null()),
  // When this recipe's photo work last moved, which is what the day separators group on. Falls back
  // to `_creationTime` for a recipe the stage backfill has not reached: those are still served by
  // `active`, which reads `by_beautify_status` and knows nothing about the migration.
  updatedAt: v.number(),
})

/** Every section has the same shape, so the screen renders one component five times. */
const workSection = v.object({
  // Empty when the section is collapsed: its documents are still read to produce the counter, but no
  // url is minted and nothing is sent over the wire.
  rows: v.array(illustrationRow),
  count: v.number(),
  truncated: v.boolean(),
})

function reportOf(recipe: Doc<'recipes'>, slot: RenditionSlot) {
  if (!sourceOf(recipe, slot)) return null
  const rendition = renditionOf(recipe, slot)
  if (rendition?.status === 'failed') {
    return { state: 'failed' as const, error: rendition.error }
  }
  return {
    state: usableDerivative(recipe, slot)
      ? ('ready' as const)
      : ('absent' as const),
    error: null,
  }
}

/**
 * The url for one slot. `thumbnail` is what separates the two kinds of screen this list carries:
 * arbitration needs the full plate — degrading the very image one is judging would take the function
 * away — while an inventory only needs to say *which* photo is there. The inventory therefore reuses
 * the storefront derivative and produces nothing extra.
 */
async function slotUrl(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
  slot: RenditionSlot,
  thumbnail: boolean,
): Promise<string | null> {
  const source = sourceOf(recipe, slot)
  if (!source) return null
  const derivative = thumbnail ? usableDerivative(recipe, slot) : null
  return ctx.storage.getUrl(derivative ? derivative.storageId : source)
}

async function toRow(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
  thumbnail: boolean,
) {
  return {
    id: recipe._id,
    title: recipe.title,
    type: recipe.type,
    status: recipe.status,
    hasOriginal: recipe.imageStorageId !== undefined,
    hasCandidate: recipe.beautifiedStorageId !== undefined,
    originalUrl: await slotUrl(ctx, recipe, 'original', thumbnail),
    candidateUrl: await slotUrl(ctx, recipe, 'beautified', thumbnail),
    originalRendition: reportOf(recipe, 'original'),
    candidateRendition: reportOf(recipe, 'beautified'),
    thumbnails: thumbnail,
    beautifyStatus: recipe.beautifyStatus,
    beautifiedAccepted: recipe.beautifiedAccepted,
    noPhotoAvailable: recipe.noPhotoAvailable ?? false,
    beautifyError: recipe.beautifyError ?? null,
    beautifyStartedAt: recipe.beautifyStartedAt ?? null,
    // The fallback is not decorative: an unmigrated recipe that is mid-generation is served by
    // `active`, and without it `updatedAt` would be `undefined` — a return-validator failure that
    // takes the whole screen down, arbitration included, for the length of the backfill.
    updatedAt: recipe.illustrationUpdatedAt ?? recipe._creationTime,
  }
}

/** The index range reads one over the cap, so a truncation is reported rather than hidden. */
function bounded(rows: Doc<'recipes'>[], limit: number) {
  return { page: rows.slice(0, limit), truncated: rows.length > limit }
}

/**
 * How much of one section to read, and whether to render it — the two questions a collapsed section
 * answers differently, resolved once.
 *
 * They used to be a single `number | null` where `null` meant "collapsed", which is why the same
 * `?? ILLUSTRATION_WORK_LISTED` fallback had to be repeated at the index range, at the page cut and at
 * the render, three places deciding the same thing.
 */
type Cap = { take: number; render: boolean }

/**
 * `null` on the wire is a folded section. It still reads its documents — the counter on a collapsed
 * `<summary>` has no other source — so it takes the default page and renders nothing.
 */
function capOf(requested: number | null): Cap {
  return requested === null
    ? { take: ILLUSTRATION_WORK_LISTED, render: false }
    : { take: boundedLimit(requested), render: true }
}

/**
 * One section, read whatever its state. `toRow` is what mints urls and drags images over the wire, so
 * a collapsed section costs its document reads and nothing else.
 */
async function sectionOf(
  ctx: QueryCtx,
  rows: Doc<'recipes'>[],
  cap: Cap,
  thumbnail: boolean,
) {
  const { page, truncated } = bounded(rows, cap.take)
  return {
    rows: cap.render
      ? await Promise.all(page.map((row) => toRow(ctx, row, thumbnail)))
      : [],
    count: page.length,
    truncated,
  }
}

/**
 * The work screen, partitioned so every recipe appears in exactly one section: `beautifyStatus !==
 * 'idle'` puts it in `active`, otherwise its `illustrationStage` decides. The exclusion lives in the
 * index range and not in a `.filter()`, because a filter runs after the scan and would make the
 * truncation this screen reports a lie.
 */
export const listIllustrationWork = query({
  args: {
    adminToken: v.string(),
    // Per-section ceiling. `null` means collapsed. Normalised server-side: `v.number()` is a float64,
    // so `NaN`, `Infinity`, negatives and decimals all cross the wire.
    limits: v.object({
      toBeautify: v.number(),
      missing: v.union(v.number(), v.null()),
      sourceHasNone: v.union(v.number(), v.null()),
      done: v.union(v.number(), v.null()),
    }),
  },
  returns: v.object({
    active: workSection,
    toBeautify: workSection,
    missing: workSection,
    sourceHasNone: workSection,
    done: workSection,
    // False until the backfill has finished. The four stage sections are then not read at all: a
    // partial work queue asks the operator to remember a banner while reading rows, and they will
    // conclude a batch is done. `active` stays whole throughout, so arbitration is never blocked.
    stagesReady: v.boolean(),
    // A single document read, from the migrations component. Counting the whole table to derive "how
    // many are off the index" would be exactly the unbounded scan the batched backfill exists to
    // avoid.
    migration: illustrationStageStatus,
  }),
  handler: async (ctx, { adminToken, limits }) => {
    requireAdmin(adminToken)
    const byStatus = (status: 'review' | 'generating' | 'failed') =>
      ctx.db
        .query('recipes')
        .withIndex('by_beautify_status', (q) => q.eq('beautifyStatus', status))
        .order('desc')
        .take(ILLUSTRATION_WORK_LISTED + 1)

    const migration = await readIllustrationStageStatus(ctx)
    const stagesReady = migration.ready

    // `toBeautify` has no folded state: it is the main flow, so its cap is always a rendering one.
    const caps = {
      toBeautify: capOf(limits.toBeautify),
      missing: capOf(limits.missing),
      sourceHasNone: capOf(limits.sourceHasNone),
      done: capOf(limits.done),
    }

    const byStage = (stage: IllustrationStage, cap: Cap) =>
      stagesReady
        ? ctx.db
            .query('recipes')
            .withIndex(
              'by_illustration_stage_and_beautify_status_and_updated_at',
              (q) =>
                q
                  .eq('illustrationStage', stage)
                  .eq('beautifyStatus', 'idle' as const),
            )
            // Descending over the third key, `illustrationUpdatedAt`: most recently touched first.
            .order('desc')
            // One over the cap, so a truncation is reported rather than silently shortening the list.
            .take(cap.take + 1)
        : Promise.resolve([])

    const [review, generating, failed, toBeautify, missing, none, done] =
      await Promise.all([
        byStatus('review'),
        byStatus('generating'),
        byStatus('failed'),
        byStage('to-beautify', caps.toBeautify),
        byStage('missing', caps.missing),
        byStage('source-has-none', caps.sourceHasNone),
        byStage('done', caps.done),
      ])

    // Waiting for arbitration first — it is work already paid for — then what is still running,
    // then what failed and can be relaunched.
    //
    // Full plates for the section one arbitrates in, thumbnails everywhere else — "À embellir"
    // included, though it is always open: measured, 50 rows × 2 full-format images ≈ 160 MB in a
    // single screen, worse than the storefront. A ~292 px thumbnail is enough to check a page is
    // legible before spending a generation.
    return {
      // Never folded, and never capped by the client: arbitration is work already paid for.
      active: await sectionOf(
        ctx,
        [...review, ...generating, ...failed],
        { take: ILLUSTRATION_WORK_LISTED, render: true },
        false,
      ),
      toBeautify: await sectionOf(ctx, toBeautify, caps.toBeautify, true),
      missing: await sectionOf(ctx, missing, caps.missing, true),
      sourceHasNone: await sectionOf(ctx, none, caps.sourceHasNone, true),
      done: await sectionOf(ctx, done, caps.done, true),
      stagesReady,
      migration,
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
    return markCurrent(
      summarizeBeautifyAttempts(attempts),
      configuredBeautifyIdentity(),
    )
  },
})
