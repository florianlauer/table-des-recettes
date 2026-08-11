import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { literalUnion } from './lib/validators'
import { LEASE_MS } from '../src/lib/queueContract'

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
// Single wording for a scan whose photo is gone, whether the purge closed it or reservation
// rejected it later.
export const PURGED_ERROR = 'Photo purgée : rescanner la page'

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

/**
 * Recomputes the purge deadline in **both** directions. A one-way `Math.min` could only shorten it,
 * so unpublishing a recipe left its photo on the seven-day path while the recipe was correctable
 * again — the one state where the photo is needed most.
 *
 * A scan emptied of its recipes is a failed scan, not a treated one: only a published recipe proves
 * the page was actually harvested, and until then the ninety-day ceiling is what eventually
 * collects it.
 */
export async function reconcileRetention(
  ctx: MutationCtx,
  scanId: Id<'scans'> | undefined,
): Promise<void> {
  if (!scanId) return
  const scan = await ctx.db.get('scans', scanId)
  if (!scan || scan.purgedAt !== undefined) return

  const recipes = await ctx.db
    .query('recipes')
    .withIndex('by_scan', (q) => q.eq('scanId', scanId))
    .collect()
  const treated =
    recipes.some((recipe) => recipe.status === 'published') &&
    !recipes.some((recipe) => recipe.status === 'review')

  const now = Date.now()
  await ctx.db.patch(scanId, {
    purgeAfter: treated
      ? now + RETENTION_AFTER_TREATMENT_MS
      : ceilingFor({ createdAt: scan.createdAt, now }),
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
    // A scan without its photo can never succeed, so the purge closes it here rather than in its
    // callers: the cron and the operator must leave the same state behind.
    const closure =
      scan.status === 'pending' || scan.status === 'extracting'
        ? {
            status: 'failed' as const,
            error: PURGED_ERROR,
            attemptId: undefined,
            startedAt: undefined,
            nextAttemptAt: undefined,
          }
        : {}
    await ctx.db.patch(scanId, {
      imageStorageIds: [],
      purgedAt: now,
      purgeAfter: undefined,
      ...closure,
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
    let alreadyPurged = 0
    let deferred = 0
    let failed = 0

    for (const scan of expired) {
      try {
        const result = await ctx.runMutation(internal.retention.purgeOneScan, {
          scanId: scan._id,
        })
        if (result === 'purged') purged += 1
        else if (result === 'already_purged') alreadyPurged += 1
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

    const leftExpiredRange = purged + alreadyPurged + failed
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
        alreadyPurged,
        deferred,
        failed,
        rescheduled,
      }),
    )
    return null
  },
})
