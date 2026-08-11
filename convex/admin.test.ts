import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ATTEMPTS_SAMPLED,
  DRAFTS_LISTED_PER_SCAN,
  QUEUE_COUNT_CAP,
} from './admin'
import { api, internal } from './_generated/api'
import { rateLimiter } from './rateLimits'
import schema from './schema'
import { LEASE_MS, MAX_ATTEMPTS } from '../src/lib/queueContract'

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
})

describe('admin boundary', () => {
  test('guards a query for valid, invalid, and absent tokens', async () => {
    const t = setup()
    await expect(
      t.query(api.admin.listScans, { adminToken: 'test-secret' }),
    ).resolves.toEqual([])
    await expect(
      t.query(api.admin.listScans, { adminToken: 'wrong' }),
    ).rejects.toThrow('Accès administrateur refusé')
    await expect(t.query(api.admin.listScans, {} as never)).rejects.toThrow()
  })

  test('guards a mutation for valid, invalid, and absent tokens', async () => {
    const t = setup()
    await expect(
      t.mutation(api.admin.generateUploadUrl, { adminToken: 'test-secret' }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      t.mutation(api.admin.generateUploadUrl, { adminToken: 'wrong' }),
    ).rejects.toThrow('Accès administrateur refusé')
    await expect(
      t.mutation(api.admin.generateUploadUrl, {} as never),
    ).rejects.toThrow()
  })

  test('creates a scan once and replays the result for the same storage id', async () => {
    const t = setup()
    const upload = await t.mutation(api.admin.generateUploadUrl, {
      adminToken: 'test-secret',
    })
    expect(upload.ok).toBe(true)
    if (!upload.ok) return
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['image'], { type: 'image/jpeg' })),
    )
    const args = {
      adminToken: 'test-secret',
      ticketId: upload.ticketId,
      storageId,
    }
    const first = await t.mutation(api.admin.createScan, args)
    const replay = await t.mutation(api.admin.createScan, args)
    expect(first).toMatchObject({ ok: true })
    expect(replay).toEqual(first)
    const scans = await t.query(api.admin.listScans, {
      adminToken: 'test-secret',
    })
    expect(scans).toHaveLength(1)
    expect(scans[0]).toMatchObject({
      status: 'pending',
      imageCount: 1,
      drafts: [],
    })
    if (!first.ok) throw new Error(first.error)
    const stored = await t.run((ctx) => ctx.db.get('scans', first.scanId))
    expect(stored?.purgeAfter).toBeGreaterThan(stored?.createdAt ?? Infinity)
  })

  test('bounds the drafts of one scan and reports the truncation', async () => {
    const t = setup()
    const scanId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('scans', {
        status: 'done',
        imageStorageIds: [],
        attempts: 1,
        createdAt: 1,
      })
      for (let index = 0; index < DRAFTS_LISTED_PER_SCAN + 2; index += 1) {
        await ctx.db.insert('recipes', {
          title: `Brouillon ${index}`,
          type: 'autre',
          ingredients: [],
          ingredientsInferred: false,
          steps: [],
          searchText: `brouillon ${index}`,
          status: 'review',
          scanId: id,
          beautifiedAccepted: false,
          beautifyStatus: 'idle',
        })
      }
      return id
    })
    const scans = await t.query(api.admin.listScans, {
      adminToken: 'test-secret',
    })
    expect(scans).toMatchObject([{ id: scanId, draftsTruncated: true }])
    expect(scans.map((scan) => scan.drafts.length)).toEqual([
      DRAFTS_LISTED_PER_SCAN,
    ])
  })

  test('leaves a sound scan untruncated', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('scans', {
        status: 'done',
        imageStorageIds: [],
        attempts: 1,
        createdAt: 1,
      })
      await ctx.db.insert('recipes', {
        title: 'Brouillon unique',
        type: 'autre',
        ingredients: [],
        ingredientsInferred: true,
        steps: [],
        searchText: 'brouillon unique',
        status: 'review',
        scanId: id,
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
    })
    const scans = await t.query(api.admin.listScans, {
      adminToken: 'test-secret',
    })
    expect(scans).toMatchObject([{ draftsTruncated: false }])
    expect(scans.map((scan) => scan.drafts.length)).toEqual([1])
  })

  test('reads the extraction journal newest first, behind the admin guard', async () => {
    const t = setup()
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        createdAt: 1,
      }),
    )
    await t.run(async (ctx) => {
      for (const [index, promptVersion] of ['v3', 'v3', 'v4'].entries()) {
        await ctx.db.insert('extractionAttempts', {
          scanId,
          attemptId: `attempt-${index}`,
          model: 'model',
          servedProvider: 'served',
          latencyMs: 7000,
          costUsd: 0.005,
          failureKind: index === 0 ? 'timeout' : null,
          repairCount: 0,
          promptVersion,
          schemaVersion: '2',
          createdAt: index,
        })
      }
    })

    await expect(
      t.query(api.admin.attemptStats, { adminToken: 'wrong' }),
    ).rejects.toThrow('Accès administrateur refusé')
    expect(
      await t.query(api.admin.attemptStats, { adminToken: 'test-secret' }),
    ).toMatchObject([
      { promptVersion: 'v4', attempts: 1, failures: 0 },
      { promptVersion: 'v3', attempts: 2, failures: 1 },
    ])
  })

  test('caps the journal read at the sampled window', async () => {
    const t = setup()
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        createdAt: 1,
      }),
    )
    await t.run(async (ctx) => {
      for (let index = 0; index <= ATTEMPTS_SAMPLED; index += 1) {
        await ctx.db.insert('extractionAttempts', {
          scanId,
          attemptId: `attempt-${index}`,
          model: 'model',
          servedProvider: null,
          latencyMs: 1,
          costUsd: 0,
          failureKind: null,
          repairCount: 0,
          promptVersion: 'v4',
          schemaVersion: '2',
          createdAt: index,
        })
      }
    })
    expect(
      await t.query(api.admin.attemptStats, { adminToken: 'test-secret' }),
    ).toMatchObject([{ attempts: ATTEMPTS_SAMPLED }])
  })

  test('reports a lease start only while the scan is extracting', async () => {
    const t = setup()
    const startedAt = Date.now()
    await t.run(async (ctx) => {
      // `finalize` leaves `startedAt` in place, so a scan that just succeeded still carries a recent
      // one. Exposing it raw would read as a live lease and hide the purge button for a lease's
      // worth of time.
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: 1,
        startedAt,
        createdAt: 2,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'extracting',
        attempts: 1,
        startedAt,
        createdAt: 1,
      })
    })
    const scans = await t.query(api.admin.listScans, {
      adminToken: 'test-secret',
    })
    expect(scans.map((scan) => [scan.status, scan.leaseStartedAt])).toEqual([
      ['extracting', startedAt],
      ['done', null],
    ])
  })

  test('limits concurrent upload grants and propagates retryAfter', async () => {
    const t = setup()
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        t.mutation(api.admin.generateUploadUrl, { adminToken: 'test-secret' }),
      ),
    )
    const refused = results.filter((result) => !result.ok)
    expect(refused.length).toBeGreaterThan(0)
    expect(refused.every((result) => result.retryAfter > 0)).toBe(true)
  })
})

describe('queue status', () => {
  test('requires an admin token', async () => {
    const t = setup()
    await expect(
      t.query(api.admin.queueStatus, { adminToken: 'wrong' }),
    ).rejects.toThrow('Accès administrateur refusé')
  })

  test('reports bounded counts, queue facts, and blocked attempts', async () => {
    const t = setup()
    const now = Date.now()
    await t.run(async (ctx) => {
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now + 10_000,
        createdAt: 10,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: MAX_ATTEMPTS,
        createdAt: 20,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'extracting',
        attempts: 2,
        startedAt: now,
        createdAt: 30,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done',
        attempts: MAX_ATTEMPTS,
        createdAt: 40,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'failed',
        attempts: MAX_ATTEMPTS,
        createdAt: 50,
      })
    })

    await expect(
      t.query(api.admin.queueStatus, { adminToken: 'test-secret' }),
    ).resolves.toEqual({
      counts: { pending: 2, extracting: 1, done: 1, failed: 1 },
      truncated: false,
      oldestPendingAt: 10,
      currentLease: { startedAt: now, attempts: 2 },
      nextAttemptAt: now + 10_000,
      attemptsCeiling: 2,
    })
  })

  test('takes one row over the count cap to report truncation', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      for (let index = 0; index < QUEUE_COUNT_CAP + 1; index += 1) {
        await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'failed',
          attempts: 1,
          createdAt: index,
        })
      }
    })
    const status = await t.query(api.admin.queueStatus, {
      adminToken: 'test-secret',
    })
    expect(status.counts.failed).toBe(QUEUE_COUNT_CAP)
    expect(status.truncated).toBe(true)
  })
})

describe('extraction launch verdict', () => {
  test('reports no work without scheduling a drain', async () => {
    const t = setup()
    await expect(
      t.mutation(api.admin.startExtraction, { adminToken: 'test-secret' }),
    ).resolves.toEqual({ status: 'no_work' })
  })

  test('reports an existing live lease', async () => {
    const t = setup()
    await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'extracting',
        attempts: 1,
        startedAt: Date.now(),
        createdAt: 1,
      }),
    )
    await expect(
      t.mutation(api.admin.startExtraction, { adminToken: 'test-secret' }),
    ).resolves.toEqual({ status: 'already_running' })
  })

  test('reports that work was scheduled', async () => {
    const t = setup()
    await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: 0,
        createdAt: 1,
      }),
    )
    await expect(
      t.mutation(api.admin.startExtraction, { adminToken: 'test-secret' }),
    ).resolves.toEqual({ status: 'scheduled' })
  })

  test('reports an absolute retry deadline when rate limited', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        const result = await rateLimiter.limit(ctx, 'extraction')
        expect(result.ok).toBe(true)
      }
      await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: 0,
        createdAt: 1,
      })
    })
    const before = Date.now()
    const result = await t.mutation(api.admin.startExtraction, {
      adminToken: 'test-secret',
    })
    expect(result.status).toBe('rate_limited')
    if (result.status === 'rate_limited')
      expect(result.retryAt).toBeGreaterThan(before)
  })

  test('reserve persists the retry scheduled by the drain', async () => {
    const t = setup()
    const scanId = await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await rateLimiter.limit(ctx, 'extraction')
      }
      return ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: 0,
        createdAt: 1,
      })
    })
    const before = Date.now()
    await expect(t.mutation(internal.extract.reserve, {})).resolves.toEqual({
      status: 'continue',
    })
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['healthy'])),
    )
    await t.run((ctx) =>
      ctx.db.patch(scanId, { imageStorageIds: [storageId], status: 'pending' }),
    )
    await expect(
      t.mutation(internal.extract.reserve, {}),
    ).resolves.toMatchObject({ status: 'rate_limited' })
    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan?.nextAttemptAt).toBeGreaterThan(before)
  })

  test('can relaunch an expired lease', async () => {
    const t = setup()
    await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'extracting',
        attempts: 1,
        startedAt: Date.now() - LEASE_MS - 1,
        createdAt: 1,
      }),
    )
    await expect(
      t.mutation(api.admin.startExtraction, { adminToken: 'test-secret' }),
    ).resolves.toEqual({ status: 'scheduled' })
  })
})
