import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ATTEMPTS_SAMPLED, DRAFTS_LISTED_PER_SCAN } from './admin'
import { api } from './_generated/api'
import schema from './schema'

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
