import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { readQueueWork } from './extract'
import { deleteStoredBlob } from './lib/blobs'
import { revisionOf } from './lib/recipeWrites'
import { rateLimiter } from './rateLimits'
import { deleteRecipeDoc } from './recipeDocs'
import { ceilingFor, reconcileRetention } from './retention'
import type { PurgeResult } from './retention'
import {
  attemptRecord,
  ingredient,
  recipeType,
  scanStatus,
  uploadPurpose,
} from './schema'
import { literalUnion, okOrError, refuse, succeeded } from './lib/validators'
import type { Refusal } from './lib/validators'
import { MAX_INPUT_BYTES } from '../src/shared/imageHeader'
import {
  ATTEMPTS_SAMPLED,
  attemptSummary,
  summarizeAttempts,
} from '../src/shared/attemptStats'
import { configuredExtractionIdentity } from '../src/shared/currentIdentity'
import { markCurrent } from '../src/shared/journalStats'
import { MAX_ATTEMPTS } from '../src/shared/queueContract'
import {
  MAX_IMAGES_PER_SCAN,
  MAX_RECIPES_PER_SCAN,
  MAX_SCAN_BYTES,
} from '../src/shared/scanLimits'

const createScanResult = v.union(
  v.object({ ok: v.literal(true), scanId: v.id('scans') }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

export const SCANS_LISTED = 100
export const QUEUE_COUNT_CAP = 1000
// The extraction schema refuses beyond this, so a scan over the cap can only be a historical one —
// which is exactly what `draftsTruncated` has to tell the operator rather than hide.
export const DRAFTS_LISTED_PER_SCAN = MAX_RECIPES_PER_SCAN

/**
 * `purpose` chooses the bucket **and** marks the ticket. Both halves matter: separate buckets with
 * unmarked tickets would only be decoration, since one drawn on the scanning quota could then be
 * spent on an illustration.
 */
export const generateUploadUrl = mutation({
  args: { adminToken: v.string(), purpose: v.optional(uploadPurpose) },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      uploadUrl: v.string(),
      ticketId: v.id('uploadTickets'),
    }),
    v.object({
      ok: v.literal(false),
      error: v.string(),
      retryAfter: v.number(),
    }),
  ),
  handler: async (ctx, { adminToken, purpose = 'scan' }) => {
    requireAdmin(adminToken)
    const illustration = purpose === 'illustration'
    const limit = await rateLimiter.limit(
      ctx,
      illustration ? 'illustrationUpload' : 'scanCreation',
    )
    if (!limit.ok) {
      return {
        ...refuse(
          illustration
            ? 'Trop de photos envoyées, réessaie plus tard'
            : 'Trop de scans créés, réessaie plus tard',
        ),
        retryAfter: limit.retryAfter,
      }
    }
    const ticketId = await ctx.db.insert('uploadTickets', {
      createdAt: Date.now(),
      purpose,
    })
    return {
      ok: true as const,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      ticketId,
    }
  },
})

/**
 * Structural edits share one gate. `extracting` is the only status that truly freezes the image set
 * — the model is reading it — and a published recipe is the only downstream thing that depends on
 * it. `done` and `failed` are not reasons: adding the verso a model missed, then rescanning, is the
 * whole point of grouping images.
 */
async function structuralGuard(
  ctx: MutationCtx,
  scan: Doc<'scans'>,
): Promise<Refusal | null> {
  if (scan.purgedAt !== undefined)
    return refuse('Les photos de ce scan sont purgées')
  if (scan.status === 'extracting')
    return refuse('Extraction en cours sur ce scan')
  const published = await ctx.db
    .query('recipes')
    .withIndex('by_scan', (q) => q.eq('scanId', scan._id))
    .filter((q) => q.eq(q.field('status'), 'published'))
    .take(1)
  return published.length > 0
    ? refuse('Une recette de ce scan est publiée : dépublie-la d’abord')
    : null
}

async function totalBytes(
  ctx: MutationCtx,
  storageIds: readonly Id<'_storage'>[],
): Promise<number> {
  const sizes = await Promise.all(
    storageIds.map(
      async (id) => (await ctx.db.system.get('_storage', id))?.size ?? 0,
    ),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

/**
 * Creates the scan when `scanId` is absent, appends to it when present. One mutation rather than
 * two because the delicate part — deciding what a replayed ticket means — must exist in a single
 * place; two copies of it would drift.
 */
export const attachImage = mutation({
  args: {
    adminToken: v.string(),
    ticketId: v.id('uploadTickets'),
    storageId: v.id('_storage'),
    scanId: v.optional(v.id('scans')),
  },
  returns: createScanResult,
  handler: async (ctx, { adminToken, ticketId, storageId, scanId }) => {
    requireAdmin(adminToken)
    const ticket = await ctx.db.get('uploadTickets', ticketId)
    if (!ticket) return refuse('Ticket de téléversement inconnu')
    if (ticket.consumedAt !== undefined) {
      if (ticket.storageId !== storageId)
        return refuse('Ticket déjà utilisé avec une autre image')
      if (ticket.outcome === 'ok' && ticket.scanId) {
        // A replay is only idempotent against the scan that consumed it; asking for another one is
        // a different intent and must not silently return the first scan.
        if (scanId && scanId !== ticket.scanId)
          return refuse('Ce téléversement appartient déjà à un autre scan')
        return { ok: true as const, scanId: ticket.scanId }
      }
      return refuse(ticket.error ?? 'Téléversement refusé')
    }

    const consumedAt = Date.now()
    // Every refusal below happens after the bytes are already in storage. Deleting the blob and
    // recording a durable outcome is what keeps a refusal from leaving the 600 kB orphan of R4.
    const reject = async (
      error: string,
      outcome: 'missing_storage' | 'too_large' | 'rejected',
    ) => {
      // No `outcome !== 'missing_storage'` guard: the helper looks before it destroys, which answers
      // the same question by observation rather than by inferring it from the label.
      await deleteStoredBlob(ctx, storageId)
      await ctx.db.patch(ticketId, {
        consumedAt,
        storageId,
        outcome,
        error,
      })
      return refuse(error)
    }

    // Before anything else on a virgin ticket: a ticket drawn on the illustration quota must not
    // buy a scan page, or the two buckets bound nothing.
    if ((ticket.purpose ?? 'scan') !== 'scan')
      return reject('Ce ticket est réservé aux photos de plat', 'rejected')

    const metadata = await ctx.db.system.get('_storage', storageId)
    if (!metadata)
      return reject('Image téléversée introuvable', 'missing_storage')
    if (metadata.size > MAX_INPUT_BYTES)
      return reject('Image trop volumineuse (25 Mo maximum)', 'too_large')

    if (scanId === undefined) {
      const created = await ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 0,
        purgeAfter: ceilingFor({ createdAt: consumedAt, now: consumedAt }),
        createdAt: consumedAt,
      })
      await ctx.db.patch(ticketId, {
        consumedAt,
        storageId,
        scanId: created,
        outcome: 'ok',
      })
      return { ok: true as const, scanId: created }
    }

    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return reject('Scan inconnu', 'rejected')
    const blocked = await structuralGuard(ctx, scan)
    if (blocked) return reject(blocked.error, 'rejected')
    if (scan.imageStorageIds.length >= MAX_IMAGES_PER_SCAN)
      return reject(
        `Un scan porte au plus ${MAX_IMAGES_PER_SCAN} images`,
        'rejected',
      )
    const existingBytes = await totalBytes(ctx, scan.imageStorageIds)
    if (existingBytes + metadata.size > MAX_SCAN_BYTES)
      return reject(
        'Les images de ce scan dépasseraient la taille totale autorisée',
        'rejected',
      )

    await ctx.db.patch(scanId, {
      imageStorageIds: [...scan.imageStorageIds, storageId],
      ...markImagesChanged(scan, consumedAt),
    })
    await ctx.db.patch(ticketId, {
      consumedAt,
      storageId,
      scanId,
      outcome: 'ok',
    })
    return { ok: true as const, scanId }
  },
})

/**
 * Only meaningful once an extraction has run: before that the recipes do not exist yet, so nothing
 * can diverge from the sources.
 */
function markImagesChanged(
  scan: Doc<'scans'>,
  now: number,
): { imagesChangedAt?: number } {
  return scan.status === 'done' || scan.status === 'failed'
    ? { imagesChangedAt: now }
    : {}
}

export const detachImage = mutation({
  args: {
    adminToken: v.string(),
    scanId: v.id('scans'),
    storageId: v.id('_storage'),
  },
  returns: okOrError,
  handler: async (ctx, { adminToken, scanId, storageId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return refuse('Scan inconnu')
    const blocked = await structuralGuard(ctx, scan)
    if (blocked) return blocked
    if (!scan.imageStorageIds.includes(storageId))
      return refuse('Cette image n’est pas dans ce scan')
    // Replacing a blurry page means passing through zero, which is fine everywhere except in the
    // queue's reach: reservation would grab the scan in between and fail it under the operator.
    if (scan.status === 'pending' && scan.imageStorageIds.length === 1)
      return refuse('Un scan en attente doit garder au moins une image')

    const now = Date.now()
    await ctx.db.patch(scanId, {
      imageStorageIds: scan.imageStorageIds.filter((id) => id !== storageId),
      ...markImagesChanged(scan, now),
    })
    await ctx.storage.delete(storageId)
    return succeeded
  },
})

/**
 * Puts a treated scan back in the queue. It drops the drafts first: `finalize` inserts without
 * deduplicating, so leaving them would produce two sets side by side.
 */
export const rescan = mutation({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: okOrError,
  handler: async (ctx, { adminToken, scanId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return refuse('Scan inconnu')
    const blocked = await structuralGuard(ctx, scan)
    if (blocked) return blocked
    const imageCount = scan.imageStorageIds.length
    if (imageCount === 0 || imageCount > MAX_IMAGES_PER_SCAN)
      return refuse(
        `Un scan à relancer doit porter de 1 à ${MAX_IMAGES_PER_SCAN} images`,
      )

    const drafts = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .collect()
    for (const draft of drafts) await deleteRecipeDoc(ctx, draft)

    // The ceiling guards a queue replaying on its own; a human who changed the input and pressed a
    // button is a new problem, not a retry of the old one. `totalReservations` and `totalCostUsd`
    // keep what this scan actually consumed.
    await ctx.db.patch(scanId, {
      status: 'pending',
      attempts: 0,
      error: undefined,
      attemptId: undefined,
      startedAt: undefined,
      nextAttemptAt: undefined,
      imagesChangedAt: undefined,
    })
    await reconcileRetention(ctx, scanId)
    return succeeded
  },
})

export const startExtraction = mutation({
  args: { adminToken: v.string() },
  returns: v.union(
    v.object({ status: v.literal('scheduled') }),
    v.object({ status: v.literal('already_running') }),
    v.object({ status: v.literal('no_work') }),
    v.object({ status: v.literal('rate_limited'), retryAt: v.number() }),
  ),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const now = Date.now()
    const { liveLease, candidates } = await readQueueWork(ctx, now)
    if (liveLease) return { status: 'already_running' as const }
    if (candidates.length === 0) return { status: 'no_work' as const }

    // Non-consuming: an idle press must not spend the quota the drain needs.
    const limit = await rateLimiter.check(ctx, 'extraction')
    if (!limit.ok) {
      return {
        status: 'rate_limited' as const,
        retryAt: now + limit.retryAfter,
      }
    }
    await ctx.scheduler.runAfter(0, internal.extract.drain, {})
    return { status: 'scheduled' as const }
  },
})

export const serverTime = mutation({
  args: { adminToken: v.string() },
  returns: v.number(),
  handler: async (_ctx, { adminToken }) => {
    requireAdmin(adminToken)
    return Date.now()
  },
})

export const queueStatus = query({
  args: { adminToken: v.string() },
  returns: v.object({
    counts: v.object({
      pending: v.number(),
      extracting: v.number(),
      done: v.number(),
      failed: v.number(),
    }),
    truncated: v.boolean(),
    oldestPendingAt: v.union(v.number(), v.null()),
    currentLease: v.union(
      v.object({ startedAt: v.number(), attempts: v.number() }),
      v.null(),
    ),
    nextAttemptAt: v.union(v.number(), v.null()),
    attemptsCeiling: v.number(),
  }),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const [pendingRows, extractingRows, doneRows, failedRows] =
      await Promise.all([
        ctx.db
          .query('scans')
          .withIndex('by_status', (q) => q.eq('status', 'pending'))
          .take(QUEUE_COUNT_CAP + 1),
        ctx.db
          .query('scans')
          .withIndex('by_status', (q) => q.eq('status', 'extracting'))
          .take(QUEUE_COUNT_CAP + 1),
        ctx.db
          .query('scans')
          .withIndex('by_status', (q) => q.eq('status', 'done'))
          .take(QUEUE_COUNT_CAP + 1),
        ctx.db
          .query('scans')
          .withIndex('by_status', (q) => q.eq('status', 'failed'))
          .take(QUEUE_COUNT_CAP + 1),
      ])
    const truncated = [pendingRows, extractingRows, doneRows, failedRows].some(
      (rows) => rows.length > QUEUE_COUNT_CAP,
    )
    const pending = pendingRows.slice(0, QUEUE_COUNT_CAP)
    const extracting = extractingRows.slice(0, QUEUE_COUNT_CAP)
    const done = doneRows.slice(0, QUEUE_COUNT_CAP)
    const failed = failedRows.slice(0, QUEUE_COUNT_CAP)
    const currentLease = extracting.reduce<{
      startedAt: number
      attempts: number
    } | null>((latest, scan) => {
      if (scan.startedAt === undefined) return latest
      if (latest !== null && latest.startedAt >= scan.startedAt) return latest
      return { startedAt: scan.startedAt, attempts: scan.attempts }
    }, null)
    const waiting = [...pending, ...extracting]
    const nextAttemptAt = waiting.reduce<number | null>((nearest, scan) => {
      if (scan.nextAttemptAt === undefined) return nearest
      return nearest === null
        ? scan.nextAttemptAt
        : Math.min(nearest, scan.nextAttemptAt)
    }, null)
    const blockedRows = [...pending, ...extracting, ...failed]
    return {
      counts: {
        pending: pending.length,
        extracting: extracting.length,
        done: done.length,
        failed: failed.length,
      },
      truncated,
      oldestPendingAt:
        pending.length === 0
          ? null
          : Math.min(...pending.map((scan) => scan.createdAt)),
      currentLease,
      nextAttemptAt,
      attemptsCeiling: blockedRows.filter(
        (scan) => scan.attempts >= MAX_ATTEMPTS,
      ).length,
    }
  },
})

export const purgeScanImages = mutation({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: v.union(
    v.literal('purged'),
    v.literal('deferred'),
    v.literal('already_purged'),
  ),
  handler: async (ctx, { adminToken, scanId }): Promise<PurgeResult> => {
    requireAdmin(adminToken)
    return ctx.runMutation(internal.retention.purgeOneScan, { scanId })
  },
})

export const attemptStats = query({
  args: { adminToken: v.string() },
  returns: v.array(attemptSummary),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const attempts = await ctx.db
      .query('extractionAttempts')
      .withIndex('by_created_at')
      .order('desc')
      .take(ATTEMPTS_SAMPLED)
    // Marked here and nowhere else: the browser cannot know which model and provider are configured,
    // and an estimate read off a retired configuration would be wrong precisely on the day someone
    // changes it.
    return markCurrent(
      summarizeAttempts(attempts),
      configuredExtractionIdentity(process.env),
    )
  },
})

export const listScans = query({
  args: { adminToken: v.string() },
  returns: v.array(
    v.object({
      id: v.id('scans'),
      status: scanStatus,
      imageCount: v.number(),
      error: v.union(v.string(), v.null()),
      drafts: v.array(
        v.object({
          id: v.id('recipes'),
          title: v.string(),
          ingredientsInferred: v.boolean(),
        }),
      ),
      draftsTruncated: v.boolean(),
      lastAttempt: v.union(attemptRecord, v.null()),
      attempts: v.number(),
      // Only meaningful while the scan is extracting, so the condition is resolved here rather than
      // left for every reader to remember.
      leaseStartedAt: v.union(v.number(), v.null()),
      nextAttemptAt: v.union(v.number(), v.null()),
      purgedAt: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const scans = await ctx.db.query('scans').order('desc').take(SCANS_LISTED)
    return Promise.all(
      scans.map(async (scan) => {
        // One over the cap, so a truncation can be reported instead of silently shortening the
        // list the page counts.
        const recipes = await ctx.db
          .query('recipes')
          .withIndex('by_scan', (q) => q.eq('scanId', scan._id))
          .take(DRAFTS_LISTED_PER_SCAN + 1)
        const truncated = recipes.length > DRAFTS_LISTED_PER_SCAN
        return {
          id: scan._id,
          status: scan.status,
          imageCount: scan.imageStorageIds.length,
          error: scan.error ?? null,
          drafts: recipes.slice(0, DRAFTS_LISTED_PER_SCAN).map((recipe) => ({
            id: recipe._id,
            title: recipe.title,
            ingredientsInferred: recipe.ingredientsInferred,
          })),
          draftsTruncated: truncated,
          lastAttempt: scan.lastAttempt ?? null,
          attempts: scan.attempts,
          leaseStartedAt:
            scan.status === 'extracting' ? (scan.startedAt ?? null) : null,
          nextAttemptAt: scan.nextAttemptAt ?? null,
          purgedAt: scan.purgedAt ?? null,
          createdAt: scan.createdAt,
        }
      }),
    )
  },
})

/**
 * Everything the correction screen reads, in one query. The recipes come back whole — it is the
 * only screen that edits them — bounded exactly like `listScans`, so a historical scan over the cap
 * reports a truncation instead of quietly shortening what the operator is about to publish.
 */
export const getScanForCorrection = query({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('scans'),
      status: scanStatus,
      error: v.union(v.string(), v.null()),
      images: v.array(
        v.object({
          storageId: v.id('_storage'),
          url: v.union(v.string(), v.null()),
        }),
      ),
      purgedAt: v.union(v.number(), v.null()),
      imagesChangedAt: v.union(v.number(), v.null()),
      totalCostUsd: v.union(v.number(), v.null()),
      createdAt: v.number(),
      // Only while extracting, as in `listScans`: the screen used to say "État : extracting" without
      // saying since when, so a running extraction was indistinguishable from a stuck one.
      startedAt: v.union(v.number(), v.null()),
      recipes: v.array(
        v.object({
          id: v.id('recipes'),
          title: v.string(),
          type: recipeType,
          servings: v.union(v.number(), v.null()),
          ingredients: v.array(ingredient),
          ingredientsInferred: v.boolean(),
          steps: v.array(v.string()),
          status: literalUnion(['review', 'published'] as const),
          slug: v.union(v.string(), v.null()),
          revision: v.number(),
        }),
      ),
      recipesTruncated: v.boolean(),
    }),
  ),
  handler: async (ctx, { adminToken, scanId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return null
    const recipes = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .take(DRAFTS_LISTED_PER_SCAN + 1)
    return {
      id: scan._id,
      status: scan.status,
      error: scan.error ?? null,
      images: await Promise.all(
        scan.imageStorageIds.map(async (storageId) => ({
          storageId,
          url: await ctx.storage.getUrl(storageId),
        })),
      ),
      purgedAt: scan.purgedAt ?? null,
      imagesChangedAt: scan.imagesChangedAt ?? null,
      totalCostUsd: scan.totalCostUsd ?? null,
      createdAt: scan.createdAt,
      startedAt: scan.status === 'extracting' ? (scan.startedAt ?? null) : null,
      recipes: recipes.slice(0, DRAFTS_LISTED_PER_SCAN).map((recipe) => ({
        id: recipe._id,
        title: recipe.title,
        type: recipe.type,
        servings: recipe.servings ?? null,
        ingredients: recipe.ingredients,
        ingredientsInferred: recipe.ingredientsInferred,
        steps: recipe.steps,
        status: recipe.status,
        slug: recipe.slug ?? null,
        revision: revisionOf(recipe),
      })),
      recipesTruncated: recipes.length > DRAFTS_LISTED_PER_SCAN,
    }
  },
})
