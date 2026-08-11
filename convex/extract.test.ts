import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'
import {
  bytesToBase64,
  eligibility,
  extractImage,
  interpretResponse,
  RESERVE_SCAN_BATCH,
  TICKET_SWEEP_BATCH,
  UNCONSUMED_TICKET_GRACE_MS,
} from './extract'
import type { Doc, Id } from './_generated/dataModel'
import { PROMPT_VERSION } from '../src/lib/recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from '../src/lib/recipe-schema'
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
} from '../src/lib/queueContract'

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
  test('keeps the lease beyond the request deadline', () => {
    expect(LEASE_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS)
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

  test('classifies an aborted request as a timeout', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    )
    await expect(
      extractImage({ blob: jpeg(), environment, fetchImpl }),
    ).resolves.toMatchObject({ ok: false, kind: 'timeout', costUsd: 0 })
  })
})

// The interpretation carries no notion of time or transport, so each failure kind costs one object
// literal instead of a fetch stub returning a whole OpenRouter envelope.
describe('answer interpretation', () => {
  const answer = (payload: unknown, status = 200) => ({
    ok: status < 400,
    status,
    body: JSON.stringify(payload),
  })
  const content = (value: unknown) => ({
    provider: 'served-provider',
    usage: { cost: 0.0045 },
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(value) } },
    ],
  })

  test('reports a model refusal', () => {
    expect(
      interpretResponse(
        answer({
          provider: 'served-provider',
          choices: [{ finish_reason: 'stop', message: { refusal: 'non' } }],
        }),
      ),
    ).toMatchObject({ ok: false, kind: 'refusal', error: 'non' })
  })

  test('reports a truncated answer', () => {
    expect(
      interpretResponse(
        answer({ choices: [{ finish_reason: 'length', message: {} }] }),
      ),
    ).toMatchObject({ ok: false, kind: 'truncated' })
  })

  test('reports an answer that misses the schema', () => {
    expect(
      interpretResponse(answer(content({ recipes: [{ title: 'Soup' }] }))),
    ).toMatchObject({ ok: false, kind: 'invalid_schema' })
  })

  test('reports an answer that found no recipe', () => {
    expect(interpretResponse(answer(content({ recipes: [] })))).toMatchObject({
      ok: false,
      kind: 'no_recipes',
    })
  })

  test('keeps the billed cost of an answer it rejects', () => {
    expect(
      interpretResponse(
        answer({
          provider: 'served-provider',
          usage: { cost: 0.0045 },
          choices: [{ finish_reason: 'length', message: {} }],
        }),
      ),
    ).toMatchObject({
      ok: false,
      costUsd: 0.0045,
      servedProvider: 'served-provider',
    })
  })

  test('reports an unreadable body without inventing a provider', () => {
    expect(
      interpretResponse({ ok: false, status: 502, body: '<html>' }),
    ).toMatchObject({
      ok: false,
      kind: 'transport',
      costUsd: 0,
      servedProvider: null,
    })
  })
})

describe('scan eligibility', () => {
  const scan = (fields: Partial<Doc<'scans'>>): Doc<'scans'> => ({
    _id: 'scan' as Id<'scans'>,
    _creationTime: 0,
    status: 'pending',
    imageStorageIds: ['image' as Id<'_storage'>],
    attempts: 0,
    createdAt: 0,
    ...fields,
  })

  test('yields the single image of a healthy scan', () => {
    expect(eligibility(scan({}))).toEqual({
      eligible: true,
      storageId: 'image',
    })
  })

  test('disqualifies a scan that exhausted its attempts', () => {
    expect(eligibility(scan({ attempts: MAX_ATTEMPTS }))).toMatchObject({
      eligible: false,
      error: 'Plafond de tentatives atteint',
    })
  })

  test('reports a purged photo before its empty image list', () => {
    expect(
      eligibility(
        scan({
          imageStorageIds: [],
          purgedAt: 1,
        }),
      ),
    ).toEqual({
      eligible: false,
      error: 'Photo purgée : rescanner la page',
    })
  })

  test('disqualifies a scan that does not hold exactly one image', () => {
    for (const imageStorageIds of [
      [],
      ['a' as Id<'_storage'>, 'b' as Id<'_storage'>],
    ])
      expect(eligibility(scan({ imageStorageIds }))).toMatchObject({
        eligible: false,
        error: 'Le scan doit contenir exactement une image',
      })
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

  test('journals every attempt of a scan, stamped with the prompt and schema versions', async () => {
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
      model: 'model',
      servedProvider: 'served',
      latencyMs: 7500,
      costUsd: 0.0051,
      repairCount: 0,
    }
    await t.mutation(internal.extract.recordFailure, {
      ...observation,
      attemptId: 'attempt-1',
      failureKind: 'transport',
      error: 'failed',
    })
    await t.run((ctx) =>
      ctx.db.patch(scanId, {
        status: 'extracting',
        attemptId: 'attempt-2',
        attempts: 2,
      }),
    )
    await t.mutation(internal.extract.finalize, {
      ...observation,
      attemptId: 'attempt-2',
      recipes: [],
    })

    const journal = await t.run((ctx) =>
      ctx.db.query('extractionAttempts').collect(),
    )
    expect(
      journal.map(({ attemptId, failureKind }) => ({ attemptId, failureKind })),
    ).toEqual([
      { attemptId: 'attempt-1', failureKind: 'transport' },
      { attemptId: 'attempt-2', failureKind: null },
    ])
    expect(journal[0]).toMatchObject({
      scanId,
      model: 'model',
      servedProvider: 'served',
      latencyMs: 7500,
      costUsd: 0.0051,
      promptVersion: PROMPT_VERSION,
      schemaVersion: RECIPE_SCHEMA_VERSION,
    })
  })

  test('journals nothing for a stale attempt', async () => {
    const t = setup()
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [storageId],
        status: 'extracting',
        attempts: 1,
        attemptId: 'current',
        startedAt: 1,
        createdAt: 1,
      }),
    )
    expect(
      await t.mutation(internal.extract.recordFailure, {
        scanId,
        attemptId: 'expired',
        model: 'model',
        servedProvider: null,
        latencyMs: 1,
        costUsd: 0,
        repairCount: 0,
        failureKind: 'transport',
        error: 'failed',
      }),
    ).toBe(false)
    expect(
      await t.run((ctx) => ctx.db.query('extractionAttempts').collect()),
    ).toEqual([])
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
      servedProvider: null,
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
