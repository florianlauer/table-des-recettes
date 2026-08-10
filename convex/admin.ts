import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireAdmin } from './auth'
import { rateLimiter } from './rateLimits'
import { attemptRecord, scanStatus } from './schema'
import { MAX_INPUT_BYTES } from '../src/lib/imageHeader'

const createScanResult = v.union(
  v.object({ ok: v.literal(true), scanId: v.id('scans') }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

export const SCANS_LISTED = 100
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
  returns: v.null(),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    await ctx.scheduler.runAfter(0, internal.extract.drain, {})
    return null
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
          createdAt: scan.createdAt,
        }
      }),
    )
  },
})
