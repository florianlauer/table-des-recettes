import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireAdmin } from './auth'
import { readQueueWork } from './extract'
import { rateLimiter } from './rateLimits'
import { ceilingFor } from './retention'
import type { PurgeResult } from './retention'
import { attemptRecord, scanStatus } from './schema'
import { MAX_INPUT_BYTES } from '../src/lib/imageHeader'
import { MAX_ATTEMPTS } from '../src/lib/queueContract'

const createScanResult = v.union(
  v.object({ ok: v.literal(true), scanId: v.id('scans') }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

export const SCANS_LISTED = 100
export const QUEUE_COUNT_CAP = 1000
// A page yields a handful of recipes — four on the worst page measured during the spike. The cap
// is therefore far above any sound extraction, and reaching it means the extraction is malformed,
// which is exactly what `draftsTruncated` has to tell the operator rather than hide.
export const DRAFTS_LISTED_PER_SCAN = 50

export const generateUploadUrl = mutation({
  args: { adminToken: v.string() },
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
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const limit = await rateLimiter.limit(ctx, 'scanCreation')
    if (!limit.ok) {
      return {
        ok: false as const,
        error: 'Trop de scans créés, réessaie plus tard',
        retryAfter: limit.retryAfter,
      }
    }
    const ticketId = await ctx.db.insert('uploadTickets', {
      createdAt: Date.now(),
    })
    return {
      ok: true as const,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      ticketId,
    }
  },
})

export const createScan = mutation({
  args: {
    adminToken: v.string(),
    ticketId: v.id('uploadTickets'),
    storageId: v.id('_storage'),
  },
  returns: createScanResult,
  handler: async (ctx, { adminToken, ticketId, storageId }) => {
    requireAdmin(adminToken)
    const ticket = await ctx.db.get('uploadTickets', ticketId)
    if (!ticket)
      return { ok: false as const, error: 'Ticket de téléversement inconnu' }
    if (ticket.consumedAt !== undefined) {
      if (ticket.storageId !== storageId)
        return {
          ok: false as const,
          error: 'Ticket déjà utilisé avec une autre image',
        }
      if (ticket.outcome === 'ok' && ticket.scanId)
        return { ok: true as const, scanId: ticket.scanId }
      return {
        ok: false as const,
        error: ticket.error ?? 'Téléversement refusé',
      }
    }

    const metadata = await ctx.db.system.get('_storage', storageId)
    const consumedAt = Date.now()
    if (!metadata) {
      const error = 'Image téléversée introuvable'
      await ctx.db.patch(ticketId, {
        consumedAt,
        storageId,
        outcome: 'missing_storage',
        error,
      })
      return { ok: false as const, error }
    }
    if (metadata.size > MAX_INPUT_BYTES) {
      const error = 'Image trop volumineuse (25 Mo maximum)'
      await ctx.db.patch(ticketId, {
        consumedAt,
        storageId,
        outcome: 'too_large',
        error,
      })
      return { ok: false as const, error }
    }

    const scanId = await ctx.db.insert('scans', {
      imageStorageIds: [storageId],
      status: 'pending',
      attempts: 0,
      purgeAfter: ceilingFor({ createdAt: consumedAt, now: consumedAt }),
      createdAt: consumedAt,
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
