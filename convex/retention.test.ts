import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import {
  BACKFILL_AUDIT_CAP,
  ceilingFor,
  PURGE_DEFERRAL_MS,
  PURGE_FAILURE_BACKOFF_MS,
  PURGE_GRACE_MS,
  PURGED_ERROR,
  reconcileRetention,
  RETENTION_AFTER_TREATMENT_MS,
  RETENTION_CEILING_MS,
} from './retention'
import { registerComponents } from '../test/convexComponents'

const modules = import.meta.glob('./**/*.ts')

function setup() {
  const t = convexTest(schema, modules)
  registerComponents(t)
  return t
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'test-secret'
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
  vi.useRealTimers()
})

describe('retention deadlines', () => {
  test('keeps a recent scan until the absolute ceiling', () => {
    expect(ceilingFor({ createdAt: 1_000, now: 1_000 })).toBe(
      1_000 + RETENTION_CEILING_MS,
    )
  })

  test('gives an old scan a grace period instead of a past deadline', () => {
    const now = RETENTION_CEILING_MS * 2
    expect(ceilingFor({ createdAt: 0, now })).toBe(now + PURGE_GRACE_MS)
  })

  test('audits one row over the cap without writing a deadline', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      for (let index = 0; index < BACKFILL_AUDIT_CAP + 1; index += 1) {
        await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'done',
          attempts: 1,
          createdAt: index,
        })
      }
    })

    await expect(
      t.mutation(internal.retention.auditPurgeAfter, {}),
    ).resolves.toMatchObject({ count: BACKFILL_AUDIT_CAP, truncated: true })
    const rows = await t.run((ctx) =>
      ctx.db.query('scans').take(BACKFILL_AUDIT_CAP + 2),
    )
    expect(rows).toHaveLength(BACKFILL_AUDIT_CAP + 1)
    expect(rows.every((scan) => scan.purgeAfter === undefined)).toBe(true)
  })

  test('backfills only scans without a deadline', async () => {
    const t = setup()
    const { missingId, existingId } = await t.run(async (ctx) => ({
      missingId: await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        createdAt: 1,
      }),
      existingId: await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        purgeAfter: 123,
        createdAt: 2,
      }),
    }))

    await t.mutation(internal.migrations.backfillPurgeAfter, {})
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.run((ctx) => ctx.db.get('scans', missingId))).toMatchObject({
      purgeAfter: expect.any(Number),
    })
    expect(await t.run((ctx) => ctx.db.get('scans', existingId))).toMatchObject(
      { purgeAfter: 123 },
    )
  })

  test('reconciles the deadline in both directions around publication', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const t = setup()
    const insertScan = (ctx: MutationCtx, createdAt: number) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done' as const,
        attempts: 1,
        purgeAfter: 9_999_999_999,
        createdAt,
      })
    const insertRecipe = (
      ctx: MutationCtx,
      scanId: Id<'scans'>,
      status: 'review' | 'published',
    ) =>
      ctx.db.insert('recipes', {
        scanId,
        title: 'Recette',
        type: 'autre' as const,
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'recette',
        status,
        beautifiedAccepted: false,
        beautifyStatus: 'idle' as const,
      })

    const { treatedId, mixedId, emptiedId, purgedId } = await t.run(
      async (ctx) => {
        const treated = await insertScan(ctx, 1)
        await insertRecipe(ctx, treated, 'published')
        const mixed = await insertScan(ctx, 2)
        await insertRecipe(ctx, mixed, 'published')
        await insertRecipe(ctx, mixed, 'review')
        const emptied = await insertScan(ctx, 3)
        const purged = await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'done' as const,
          attempts: 1,
          purgeAfter: 2_000_000,
          purgedAt: 500_000,
          createdAt: 4,
        })
        return {
          treatedId: treated,
          mixedId: mixed,
          emptiedId: emptied,
          purgedId: purged,
        }
      },
    )

    for (const scanId of [treatedId, mixedId, emptiedId, purgedId])
      await t.run((ctx) => reconcileRetention(ctx, scanId))

    const ceiling = (createdAt: number) =>
      ceilingFor({ createdAt, now: 1_000_000 })
    // Published and nothing left in review: the photo has done its job.
    expect(await t.run((ctx) => ctx.db.get('scans', treatedId))).toMatchObject({
      purgeAfter: 1_000_000 + RETENTION_AFTER_TREATMENT_MS,
    })
    // One recipe back in review pulls the deadline back up — the case a one-way Math.min missed.
    expect(await t.run((ctx) => ctx.db.get('scans', mixedId))).toMatchObject({
      purgeAfter: ceiling(2),
    })
    // No recipe at all is a failed scan, not a treated one.
    expect(await t.run((ctx) => ctx.db.get('scans', emptiedId))).toMatchObject({
      purgeAfter: ceiling(3),
    })
    expect(await t.run((ctx) => ctx.db.get('scans', purgedId))).toMatchObject({
      purgeAfter: 2_000_000,
    })
  })

  test('ignores a recipe that has no parent scan', async () => {
    const t = setup()
    await expect(
      t.run((ctx) => reconcileRetention(ctx, undefined)),
    ).resolves.toBeNull()
  })
})

describe('retention purge', () => {
  test('does not purge a scan that has no purgeAfter', async () => {
    const t = setup()
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['scan'])),
    )
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'done',
        attempts: 1,
        createdAt: 1,
      }),
    )

    await t.mutation(internal.retention.purgeExpired, {})
    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan).toMatchObject({ imageStorageIds: [storageId] })
    expect(scan?.purgedAt).toBeUndefined()
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null),
    ).toBe(true)
  })

  test('defers an expired live lease and preserves its blob', async () => {
    const t = setup()
    const now = Date.now()
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['scan'])),
    )
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'extracting',
        attempts: 1,
        attemptId: 'live',
        startedAt: now,
        purgeAfter: now - 1,
        createdAt: 1,
      }),
    )

    await t.mutation(internal.retention.purgeExpired, {})
    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan?.purgeAfter).toBeGreaterThanOrEqual(now + PURGE_DEFERRAL_MS)
    expect(scan).toMatchObject({ imageStorageIds: [storageId] })
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null),
    ).toBe(true)
  })

  test('backs off a failed deletion and continues with the next scan', async () => {
    const t = setup()
    const now = Date.now()
    const brokenStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['broken'])),
    )
    const rollbackStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['must survive'])),
    )
    const healthyStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['healthy'])),
    )
    const { brokenId, healthyId } = await t.run(async (ctx) => {
      const scanWithBrokenBlobId = await ctx.db.insert('scans', {
        imageStorageIds: [rollbackStorageId, brokenStorageId],
        status: 'done',
        attempts: 1,
        purgeAfter: now - 2,
        createdAt: 1,
      })
      const healthyScanId = await ctx.db.insert('scans', {
        imageStorageIds: [healthyStorageId],
        status: 'done',
        attempts: 1,
        purgeAfter: now - 1,
        createdAt: 2,
      })
      await ctx.storage.delete(brokenStorageId)
      return {
        brokenId: scanWithBrokenBlobId,
        healthyId: healthyScanId,
      }
    })

    await t.mutation(internal.retention.purgeExpired, {})
    const broken = await t.run((ctx) => ctx.db.get('scans', brokenId))
    expect(broken).toMatchObject({
      imageStorageIds: [rollbackStorageId, brokenStorageId],
    })
    expect(broken?.purgedAt).toBeUndefined()
    expect(
      await t.run(
        async (ctx) => (await ctx.storage.get(rollbackStorageId)) !== null,
      ),
    ).toBe(true)
    expect(broken?.purgeAfter).toBeGreaterThanOrEqual(
      now + PURGE_FAILURE_BACKOFF_MS,
    )
    const healthy = await t.run((ctx) => ctx.db.get('scans', healthyId))
    expect(healthy).toMatchObject({
      imageStorageIds: [],
      purgedAt: expect.any(Number),
    })
    expect(healthy?.purgeAfter).toBeUndefined()
  })

  test('purges the blob but preserves the scan row', async () => {
    const t = setup()
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['scan'])),
    )
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'done',
        attempts: 1,
        purgeAfter: Date.now() - 1,
        createdAt: 1,
      }),
    )

    await expect(
      t.mutation(internal.retention.purgeOneScan, { scanId }),
    ).resolves.toBe('purged')
    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan).toMatchObject({
      imageStorageIds: [],
      purgedAt: expect.any(Number),
    })
    expect(scan?.purgeAfter).toBeUndefined()
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(storageId)) === null),
    ).toBe(true)
  })
})

describe('manual purge', () => {
  test('requires an admin token', async () => {
    const t = setup()
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        createdAt: 1,
      }),
    )
    await expect(
      t.mutation(api.admin.purgeScanImages, {
        adminToken: 'wrong',
        scanId,
      }),
    ).rejects.toThrow('Accès administrateur refusé')
  })

  test('defers a live lease', async () => {
    const t = setup()
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['scan'])),
    )
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'extracting',
        attempts: 1,
        attemptId: 'live',
        startedAt: Date.now(),
        createdAt: 1,
      }),
    )
    await expect(
      t.mutation(api.admin.purgeScanImages, {
        adminToken: 'test-secret',
        scanId,
      }),
    ).resolves.toBe('deferred')
    expect(
      await t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null),
    ).toBe(true)
  })

  test('fails a pending scan immediately and remains idempotent', async () => {
    const t = setup()
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['scan'])),
    )
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 0,
        createdAt: 1,
      }),
    )
    const args = { adminToken: 'test-secret', scanId }
    await expect(t.mutation(api.admin.purgeScanImages, args)).resolves.toBe(
      'purged',
    )
    expect(await t.run((ctx) => ctx.db.get('scans', scanId))).toMatchObject({
      status: 'failed',
      error: PURGED_ERROR,
    })
    await expect(t.mutation(api.admin.purgeScanImages, args)).resolves.toBe(
      'already_purged',
    )
  })

  test('leaves the same state as the cron for the same pending scan', async () => {
    const t = setup()
    const scanId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['scan']))
      return ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 1,
        nextAttemptAt: Date.now() + 60_000,
        purgeAfter: Date.now() - 1,
        createdAt: 1,
      })
    })

    await t.mutation(internal.retention.purgeExpired, {})
    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan).toMatchObject({
      status: 'failed',
      error: PURGED_ERROR,
      imageStorageIds: [],
      purgedAt: expect.any(Number),
    })
    expect(scan?.nextAttemptAt).toBeUndefined()
  })

  test('does not reopen a terminal scan it purges', async () => {
    const t = setup()
    const scanId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['scan']))
      return ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'done',
        attempts: 1,
        purgeAfter: Date.now() - 1,
        createdAt: 1,
      })
    })

    await t.mutation(internal.retention.purgeExpired, {})
    expect(await t.run((ctx) => ctx.db.get('scans', scanId))).toMatchObject({
      status: 'done',
      purgedAt: expect.any(Number),
    })
  })
})
