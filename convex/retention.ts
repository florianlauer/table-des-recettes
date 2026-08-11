import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { LEASE_MS } from './extract'
import { literalUnion } from './lib/validators'

export const RETENTION_AFTER_TREATMENT_MS = 7 * 24 * 60 * 60 * 1000
export const RETENTION_CEILING_MS = 90 * 24 * 60 * 60 * 1000
// No photo can be purged before this delay after its deadline is set, regardless of its age. This
// keeps the backfill from sending historical scans to the first purge run.
export const PURGE_GRACE_MS = 14 * 24 * 60 * 60 * 1000
// A live extraction must have time to finish before another purge attempt can inspect the scan.
export const PURGE_DEFERRAL_MS = 2 * LEASE_MS
// Failed rows leave the expired range so one broken batch cannot starve every scan behind it.
export const PURGE_FAILURE_BACKOFF_MS = 24 * 60 * 60 * 1000
export const PURGE_BATCH = 100
export const BACKFILL_AUDIT_CAP = 1000

const purgeResult = literalUnion([
  'purged',
  'deferred',
  'already_purged',
] as const)

export type PurgeResult = 'purged' | 'deferred' | 'already_purged'

export function ceilingFor({
  createdAt,
  now,
}: {
  createdAt: number
  now: number
}): number {
  return Math.max(createdAt + RETENTION_CEILING_MS, now + PURGE_GRACE_MS)
}

export async function releaseIfTreated(
  ctx: MutationCtx,
  scanId: Id<'scans'>,
): Promise<void> {
  const scan = await ctx.db.get('scans', scanId)
  if (!scan || scan.purgedAt !== undefined) return

  const reviewRecipes = await ctx.db
    .query('recipes')
    .withIndex('by_scan', (q) => q.eq('scanId', scanId))
    .filter((q) => q.eq(q.field('status'), 'review'))
    .take(1)
  if (reviewRecipes.length > 0) return

  await ctx.db.patch(scanId, {
    purgeAfter: Math.min(
      scan.purgeAfter ?? Infinity,
      Date.now() + RETENTION_AFTER_TREATMENT_MS,
    ),
  })
}

export const auditPurgeAfter = internalMutation({
  args: {},
  returns: v.object({
    count: v.number(),
    minimumPurgeAfter: v.union(v.number(), v.null()),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now()
    const rows = await ctx.db
      .query('scans')
      .withIndex('by_purge_after', (q) => q.eq('purgeAfter', undefined))
      .take(BACKFILL_AUDIT_CAP + 1)
    const truncated = rows.length > BACKFILL_AUDIT_CAP
    const audited = rows.slice(0, BACKFILL_AUDIT_CAP)
    const minimumPurgeAfter = audited.reduce<number | null>((minimum, scan) => {
      const deadline = ceilingFor({ createdAt: scan.createdAt, now })
      return minimum === null ? deadline : Math.min(minimum, deadline)
    }, null)
    const result = {
      count: audited.length,
      minimumPurgeAfter,
      truncated,
    }
    console.log(JSON.stringify({ operation: 'retention_audit', ...result }))
    return result
  },
})

export const backfillPurgeAfter = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const rows = await ctx.db
      .query('scans')
      .withIndex('by_purge_after', (q) => q.eq('purgeAfter', undefined))
      .take(PURGE_BATCH)
    for (const scan of rows) {
      await ctx.db.patch(scan._id, {
        purgeAfter: ceilingFor({ createdAt: scan.createdAt, now }),
      })
    }
    const rescheduled = rows.length === PURGE_BATCH
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.retention.backfillPurgeAfter, {})
    }
    console.log(
      JSON.stringify({
        operation: 'retention_backfill',
        processed: rows.length,
        rescheduled,
      }),
    )
    return null
  },
})

export const purgeOneScan = internalMutation({
  args: { scanId: v.id('scans') },
  returns: purgeResult,
  handler: async (ctx, { scanId }): Promise<PurgeResult> => {
    const scan = await ctx.db.get('scans', scanId)
    if (!scan || scan.purgedAt !== undefined) return 'already_purged'

    const now = Date.now()
    if (
      scan.status === 'extracting' &&
      scan.startedAt !== undefined &&
      scan.startedAt > now - LEASE_MS
    ) {
      await ctx.db.patch(scanId, {
        purgeAfter: now + PURGE_DEFERRAL_MS,
      })
      return 'deferred'
    }

    for (const storageId of scan.imageStorageIds) {
      await ctx.storage.delete(storageId)
    }
    await ctx.db.patch(scanId, {
      imageStorageIds: [],
      purgedAt: now,
      purgeAfter: undefined,
    })
    return 'purged'
  },
})

export const purgeExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const batchId = crypto.randomUUID()
    const expired = await ctx.db
      .query('scans')
      .withIndex('by_purge_after', (q) =>
        q.gte('purgeAfter', 0).lt('purgeAfter', now),
      )
      .take(PURGE_BATCH)
    let purged = 0
    let deferred = 0
    let failed = 0

    for (const scan of expired) {
      try {
        const result = await ctx.runMutation(internal.retention.purgeOneScan, {
          scanId: scan._id,
        })
        if (result === 'purged' || result === 'already_purged') purged += 1
        else deferred += 1
      } catch (error) {
        failed += 1
        await ctx.db.patch(scan._id, {
          purgeAfter: now + PURGE_FAILURE_BACKOFF_MS,
        })
        console.log(
          JSON.stringify({
            operation: 'retention_purge_failure',
            batchId,
            scanId: scan._id,
            error: String(error),
          }),
        )
      }
    }

    const leftExpiredRange = purged + failed
    const rescheduled = expired.length === PURGE_BATCH && leftExpiredRange > 0
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.retention.purgeExpired, {})
    }
    console.log(
      JSON.stringify({
        operation: 'retention_purge',
        batchId,
        examined: expired.length,
        purged,
        deferred,
        failed,
        rescheduled,
      }),
    )
    return null
  },
})
