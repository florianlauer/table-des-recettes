import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
