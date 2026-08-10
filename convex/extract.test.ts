import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'
import {
  bytesToBase64,
  extractImage,
  LEASE_MS,
  MAX_TRANSPORT_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  RESERVE_SCAN_BATCH,
  TICKET_SWEEP_BATCH,
  UNCONSUMED_TICKET_GRACE_MS,
} from './extract'

const modules = import.meta.glob('./**/*.ts')
const environment = {
  OPENROUTER_API_KEY: 'key',
  OPENROUTER_MODEL: 'model',
  OPENROUTER_PROVIDER: 'provider',
}

function jpeg(): Blob {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16])
  return new Blob([bytes], { type: 'image/jpeg' })
}

function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  return t
}

describe('extraction transport', () => {
  test('keeps the lease beyond every request deadline', () => {
    expect(LEASE_MS).toBeGreaterThan(
      REQUEST_TIMEOUT_MS * MAX_TRANSPORT_ATTEMPTS,
    )
    expect(MAX_TRANSPORT_ATTEMPTS).toBe(1)
    expect(bytesToBase64(new Uint8Array([0, 1, 2]))).toBe('AAEC')
  })

  test('refuses invalid bytes before fetch', async () => {
    const fetchImpl = vi.fn()
    const result = await extractImage({
      blob: new Blob(['bad']),
      environment,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, kind: 'invalid_image' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('validates and normalizes a successful answer', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: 'served-provider',
            usage: { cost: 0.0045 },
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    recipes: [
                      {
                        title: 'Soup',
                        type: 'entree',
                        servings: '4 people',
                        ingredients: [
                          {
                            raw: '1 onion',
                            quantity: 1,
                            unit: null,
                            label: null,
                          },
                        ],
                        ingredientsInferred: false,
                        steps: ['Cook.'],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const result = await extractImage({ blob: jpeg(), environment, fetchImpl })
    expect(result).toMatchObject({
      ok: true,
      repairCount: 1,
      servedProvider: 'served-provider',
      costUsd: 0.0045,
    })
    if (result.ok) expect(result.extraction.recipes[0]?.servings).toBe(4)
  })

  test('categorizes malformed model JSON', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: 'served-provider',
            choices: [{ finish_reason: 'stop', message: { content: '{' } }],
          }),
          { status: 200 },
        ),
    )
    await expect(
      extractImage({ blob: jpeg(), environment, fetchImpl }),
    ).resolves.toMatchObject({ ok: false, kind: 'invalid_json' })
  })

  test('does not retry a failed HTTP response within one reservation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'provider failed' } }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            provider: 'served-provider',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    recipes: [
                      {
                        title: 'Soup',
                        type: 'entree',
                        servings: 4,
                        ingredients: [],
                        ingredientsInferred: false,
                        steps: ['Cook.'],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )

    await expect(
      extractImage({ blob: jpeg(), environment, fetchImpl }),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('extraction state machine', () => {
  test('holds a global live lease across different scans', async () => {
    const t = setup()
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run(async (ctx) => {
      await ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'extracting',
        attempts: 1,
        attemptId: 'live',
        startedAt: Date.now(),
        createdAt: 1,
      })
      await ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 0,
        createdAt: 2,
      })
    })
    await expect(t.mutation(internal.extract.reserve, {})).resolves.toEqual({
      status: 'lease_held',
    })
  })

  test('fails a malformed scan and reserves the next healthy scan', async () => {
    const t = setup()
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    const { malformedId, healthyId } = await t.run(async (ctx) => ({
      malformedId: await ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'pending',
        attempts: 0,
        createdAt: 1,
      }),
      healthyId: await ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 0,
        createdAt: 2,
      }),
    }))

    await expect(
      t.mutation(internal.extract.reserve, {}),
    ).resolves.toMatchObject({ status: 'reserved', scanId: healthyId })
    expect(
      await t.run((ctx) => ctx.db.get('scans', malformedId)),
    ).toMatchObject({ status: 'failed' })
  })

  test('continues after a full malformed batch instead of declaring no work', async () => {
    const t = setup()
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run(async (ctx) => {
      for (let index = 0; index < RESERVE_SCAN_BATCH; index += 1) {
        await ctx.db.insert('scans', {
          imageStorageIds: [],
          status: 'pending',
          attempts: 0,
          createdAt: index,
        })
      }
      await ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'pending',
        attempts: 0,
        createdAt: RESERVE_SCAN_BATCH,
      })
    })

    await expect(t.mutation(internal.extract.reserve, {})).resolves.toEqual({
      status: 'continue',
    })
    await expect(
      t.mutation(internal.extract.reserve, {}),
    ).resolves.toMatchObject({ status: 'reserved' })
  })

  test('requeues retryable failures and terminates invalid images', async () => {
    const t = setup()
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'extracting',
        attempts: 1,
        attemptId: 'attempt-1',
        startedAt: 1,
        createdAt: 1,
      }),
    )
    const observation = {
      scanId,
      attemptId: 'attempt-1',
      model: 'model',
      latencyMs: 1,
      costUsd: 0,
      repairCount: 0,
      error: 'failed',
    }
    expect(
      await t.mutation(internal.extract.recordFailure, {
        ...observation,
        failureKind: 'transport',
      }),
    ).toBe(true)
    expect(await t.run((ctx) => ctx.db.get('scans', scanId))).toMatchObject({
      status: 'pending',
    })
    await t.run((ctx) =>
      ctx.db.patch(scanId, {
        status: 'extracting',
        attemptId: 'attempt-2',
        attempts: 2,
      }),
    )
    expect(
      await t.mutation(internal.extract.recordFailure, {
        ...observation,
        attemptId: 'attempt-2',
        failureKind: 'invalid_image',
      }),
    ).toBe(true)
    expect(await t.run((ctx) => ctx.db.get('scans', scanId))).toMatchObject({
      status: 'failed',
    })
  })

  test('sweeps an expired unconsumed ticket past a recent consumed prefix', async () => {
    const t = setup()
    const now = Date.now()
    const expiredTicketId = await t.run(async (ctx) => {
      for (let index = 0; index <= TICKET_SWEEP_BATCH; index += 1) {
        await ctx.db.insert('uploadTickets', {
          createdAt:
            now - UNCONSUMED_TICKET_GRACE_MS - TICKET_SWEEP_BATCH + index,
          consumedAt: now,
          outcome: 'ok',
        })
      }
      return ctx.db.insert('uploadTickets', {
        createdAt: now - UNCONSUMED_TICKET_GRACE_MS - 1,
      })
    })

    expect(await t.mutation(internal.extract.sweepTickets, {})).toBe(1)
    expect(
      await t.run((ctx) => ctx.db.get('uploadTickets', expiredTicketId)),
    ).toBeNull()
  })
})
