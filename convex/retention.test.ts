import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import {
  BACKFILL_AUDIT_CAP,
  ceilingFor,
  PURGE_DEFERRAL_MS,
  PURGE_FAILURE_BACKOFF_MS,
  PURGE_GRACE_MS,
  releaseIfTreated,
  RETENTION_AFTER_TREATMENT_MS,
  RETENTION_CEILING_MS,
} from './retention'

const modules = import.meta.glob('./**/*.ts')

function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
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

    await t.mutation(internal.retention.backfillPurgeAfter, {})
    expect(await t.run((ctx) => ctx.db.get('scans', missingId))).toMatchObject({
      purgeAfter: expect.any(Number),
    })
    expect(await t.run((ctx) => ctx.db.get('scans', existingId))).toMatchObject(
      { purgeAfter: 123 },
    )
  })

  test('releases only treated scans, lowering but never extending a deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const t = setup()
    const { reviewId, loweredId, preservedId } = await t.run(async (ctx) => {
      const scanWithReviewId = await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        purgeAfter: 9_999_999_999,
        createdAt: 1,
      })
      await ctx.db.insert('recipes', {
        scanId: scanWithReviewId,
        title: 'Review',
        type: 'autre',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'review',
        status: 'review',
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
      return {
        reviewId: scanWithReviewId,
        loweredId: await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'done',
          attempts: 1,
          purgeAfter: 9_999_999_999,
          createdAt: 2,
        }),
        preservedId: await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'done',
          attempts: 1,
          purgeAfter: 2_000_000,
          createdAt: 3,
        }),
      }
    })

    await t.run((ctx) => releaseIfTreated(ctx, reviewId))
    await t.run((ctx) => releaseIfTreated(ctx, loweredId))
    await t.run((ctx) => releaseIfTreated(ctx, preservedId))
    expect(await t.run((ctx) => ctx.db.get('scans', reviewId))).toMatchObject({
      purgeAfter: 9_999_999_999,
    })
    expect(await t.run((ctx) => ctx.db.get('scans', loweredId))).toMatchObject({
      purgeAfter: 1_000_000 + RETENTION_AFTER_TREATMENT_MS,
    })
    expect(
      await t.run((ctx) => ctx.db.get('scans', preservedId)),
    ).toMatchObject({ purgeAfter: 2_000_000 })
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
      error: 'Photo purgée',
    })
    await expect(t.mutation(api.admin.purgeScanImages, args)).resolves.toBe(
      'already_purged',
    )
  })
})
