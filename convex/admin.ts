import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { requireAdmin } from './auth'
import { rateLimiter } from './rateLimits'
import { MAX_INPUT_BYTES } from '../src/lib/imageHeader'

const createScanResult = v.union(
  v.object({ ok: v.literal(true), scanId: v.id('scans') }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

const lastAttempt = v.object({
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.union(v.string(), v.null()),
  latencyMs: v.number(),
  costUsd: v.number(),
  failureKind: v.union(
    v.literal('refusal'),
    v.literal('truncated'),
    v.literal('invalid_json'),
    v.literal('invalid_schema'),
    v.literal('timeout'),
    v.literal('transport'),
    v.literal('no_recipes'),
    v.literal('invalid_image'),
    v.null(),
  ),
  repairCount: v.number(),
})

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
      status: v.union(
        v.literal('pending'),
        v.literal('extracting'),
        v.literal('done'),
        v.literal('failed'),
      ),
      imageCount: v.number(),
      error: v.union(v.string(), v.null()),
      drafts: v.array(
        v.object({
          id: v.id('recipes'),
          title: v.string(),
          ingredientsInferred: v.boolean(),
        }),
      ),
      lastAttempt: v.union(lastAttempt, v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { adminToken }) => {
    requireAdmin(adminToken)
    const scans = await ctx.db.query('scans').order('desc').take(100)
    return Promise.all(
      scans.map(async (scan) => {
        const recipes = await ctx.db
          .query('recipes')
          .withIndex('by_scan', (q) => q.eq('scanId', scan._id))
          .collect()
        return {
          id: scan._id,
          status: scan.status,
          imageCount: scan.imageStorageIds.length,
          error: scan.error ?? null,
          drafts: recipes.map((recipe) => ({
            id: recipe._id,
            title: recipe.title,
            ingredientsInferred: recipe.ingredientsInferred,
          })),
          lastAttempt: scan.lastAttempt
            ? {
                ...scan.lastAttempt,
                servedProvider: scan.lastAttempt.servedProvider ?? null,
                failureKind: scan.lastAttempt.failureKind ?? null,
              }
            : null,
          createdAt: scan.createdAt,
        }
      }),
    )
  },
})
