import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { internal } from './_generated/api'
import {
  beautifyImage,
  decodeBeautifiedImage,
  MAX_BASE64_CHARS,
  MAX_RESPONSE_BYTES,
  readBoundedBody,
} from './beautify'
import schema from './schema'
import { bytesToBase64 } from '../src/lib/base64'
import { BEAUTIFY_MODEL } from '../src/lib/beautifyPrompt'
import { registerComponents } from '../test/convexComponents'

const modules = import.meta.glob('./**/*.ts')
const environment = { OPENROUTER_API_KEY: 'key' }

function jpegBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16])
  return bytes
}

function jpeg(): Blob {
  return new Blob([jpegBytes()], { type: 'image/jpeg' })
}

function imageAnswer(base64: string = bytesToBase64(jpegBytes())) {
  return {
    provider: 'google-vertex',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          images: [{ image_url: { url: `data:image/jpeg;base64,${base64}` } }],
        },
      },
    ],
    usage: { cost: 0.03944 },
  }
}

function setup() {
  const t = convexTest(schema, modules)
  registerComponents(t)
  return t
}

async function insertRecipe(
  t: ReturnType<typeof setup>,
  over: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    const imageStorageId = await ctx.storage.store(jpeg())
    const recipeId = await ctx.db.insert('recipes', {
      title: 'Clafoutis',
      type: 'dessert',
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
      searchText: 'clafoutis',
      status: 'review',
      imageStorageId,
      hasIllustration: true,
      beautifiedAccepted: false,
      beautifyStatus: 'idle',
      ...over,
    })
    return { recipeId, imageStorageId }
  })
}

const observation = {
  model: BEAUTIFY_MODEL,
  servedProvider: 'google-vertex',
  latencyMs: 9100,
  costUsd: 0.03944,
  costReported: true,
}

describe('model output decoding', () => {
  test('accepts a well-formed data URI', () => {
    const decoded = decodeBeautifiedImage(imageAnswer())
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.mediaType).toBe('image/jpeg')
  })

  test('converts the three bench failures onto the image taxonomy', () => {
    expect(
      decodeBeautifiedImage({
        choices: [{ message: { refusal: 'non' } }],
      }),
    ).toMatchObject({ ok: false, kind: 'refusal' })
    expect(
      decodeBeautifiedImage({
        choices: [{ finish_reason: 'length', message: {} }],
      }),
    ).toMatchObject({ ok: false, kind: 'truncated' })
    expect(
      decodeBeautifiedImage({
        choices: [{ finish_reason: 'stop', message: { content: 'voici' } }],
      }),
    ).toMatchObject({ ok: false, kind: 'no_image' })
  })

  test('refuses an oversized image on its encoded length, before decoding it', () => {
    // A base64 string this long would decode to more than the upload ceiling. Nothing is decoded:
    // the refusal happens on the string itself, which is the whole point of the ordering.
    const decoded = decodeBeautifiedImage(
      imageAnswer('A'.repeat(MAX_BASE64_CHARS + 1)),
    )
    expect(decoded).toMatchObject({ ok: false, kind: 'truncated' })
  })

  test('refuses bytes that do not carry a readable image header', () => {
    const decoded = decodeBeautifiedImage(
      imageAnswer(bytesToBase64(new Uint8Array([1, 2, 3, 4]))),
    )
    expect(decoded).toMatchObject({ ok: false, kind: 'invalid_image' })
  })
})

describe('bounded response reading', () => {
  test('abandons a body that crosses the ceiling while it is being read', async () => {
    const body = 'x'.repeat(64)
    await expect(readBoundedBody(new Response(body), 16)).resolves.toEqual({
      ok: false,
    })
  })

  test('returns a body that stays under it', async () => {
    await expect(readBoundedBody(new Response('{}'), 16)).resolves.toEqual({
      ok: true,
      text: '{}',
    })
  })
})

describe('one billed call', () => {
  test('sends the image modality, without which the model answers in words', async () => {
    let sent: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify(imageAnswer()))
    })
    const result = await beautifyImage({
      blob: jpeg(),
      environment,
      fetchImpl: fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, servedProvider: 'google-vertex' })
    expect(sent.modalities).toEqual(['image', 'text'])
    expect(sent.model).toBe(BEAUTIFY_MODEL)
  })

  test('spends nothing when the source is missing or unreadable', async () => {
    const fetchImpl = vi.fn()
    await expect(
      beautifyImage({
        blob: null,
        environment,
        fetchImpl: fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'invalid_image' })
    await expect(
      beautifyImage({
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        environment,
        fetchImpl: fetchImpl,
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'invalid_image' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('journals a missing price as unreported rather than as a free call', async () => {
    const answer = imageAnswer()
    delete (answer as { usage?: unknown }).usage
    const result = await beautifyImage({
      blob: jpeg(),
      environment,
      fetchImpl: async () => new Response(JSON.stringify(answer)),
    })
    expect(result).toMatchObject({ ok: true, costUsd: 0, costReported: false })
  })

  test('refuses a body over the ceiling instead of decoding it', async () => {
    const huge = JSON.stringify(imageAnswer('A'.repeat(MAX_RESPONSE_BYTES)))
    const result = await beautifyImage({
      blob: jpeg(),
      environment,
      fetchImpl: async () => new Response(huge),
    })
    expect(result).toMatchObject({ ok: false, kind: 'truncated' })
  })
})

describe('finalisation', () => {
  test('adopts the candidate and journals it as pending', async () => {
    const t = setup()
    const { recipeId, imageStorageId } = await insertRecipe(t)
    const attemptId = 'attempt-1'
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'generating',
        beautifyAttemptId: attemptId,
        beautifyStartedAt: Date.now(),
      }),
    )
    const candidateStorageId = await t.run((ctx) => ctx.storage.store(jpeg()))

    await expect(
      t.mutation(internal.beautify.finalizeBeautify, {
        ...observation,
        attemptId,
        recipeId,
        sourceStorageId: imageStorageId,
        candidateStorageId,
      }),
    ).resolves.toBe('adopted')

    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe).toMatchObject({
      beautifyStatus: 'review',
      beautifiedStorageId: candidateStorageId,
    })
    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ outcome: 'pending', failureKind: null })
  })

  test('replayed after adoption, returns adopted without destroying the candidate', async () => {
    const t = setup()
    const { recipeId, imageStorageId } = await insertRecipe(t)
    const attemptId = 'attempt-1'
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'generating',
        beautifyAttemptId: attemptId,
      }),
    )
    const candidateStorageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    const args = {
      ...observation,
      attemptId,
      recipeId,
      sourceStorageId: imageStorageId,
      candidateStorageId,
    }
    await t.mutation(internal.beautify.finalizeBeautify, args)

    // The second call no longer sees `generating`; without the replay check it would read the
    // attempt as stale and delete a blob the recipe now points at.
    await expect(
      t.mutation(internal.beautify.finalizeBeautify, args),
    ).resolves.toBe('adopted')

    const [recipe, attempts, blob] = await t.run(async (ctx) => [
      await ctx.db.get('recipes', recipeId),
      await ctx.db.query('beautifyAttempts').collect(),
      await ctx.db.system.get('_storage', candidateStorageId),
    ])
    expect(recipe).toMatchObject({ beautifiedStorageId: candidateStorageId })
    // One row for one billed call: a second would double the cost in the aggregate.
    expect(attempts).toHaveLength(1)
    expect(blob).not.toBeNull()
  })

  test('destroys a candidate rendered from an image that has since been replaced', async () => {
    const t = setup()
    const { recipeId } = await insertRecipe(t)
    const attemptId = 'attempt-1'
    const staleSource = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'generating',
        beautifyAttemptId: attemptId,
      }),
    )
    const candidateStorageId = await t.run((ctx) => ctx.storage.store(jpeg()))

    await expect(
      t.mutation(internal.beautify.finalizeBeautify, {
        ...observation,
        attemptId,
        recipeId,
        sourceStorageId: staleSource,
        candidateStorageId,
      }),
    ).resolves.toBe('discarded')

    const [recipe, attempts, blob] = await t.run(async (ctx) => [
      await ctx.db.get('recipes', recipeId),
      await ctx.db.query('beautifyAttempts').collect(),
      await ctx.db.system.get('_storage', candidateStorageId),
    ])
    expect(recipe?.beautifiedStorageId).toBeUndefined()
    expect(blob).toBeNull()
    // Billed, so still journalled — and `discarded`, since no arbitration was ever possible.
    expect(attempts[0]).toMatchObject({
      outcome: 'discarded',
      failureKind: null,
    })
  })

  test('records a technical failure with its kind and leaves the recipe relaunchable', async () => {
    const t = setup()
    const { recipeId, imageStorageId } = await insertRecipe(t)
    const attemptId = 'attempt-1'
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'generating',
        beautifyAttemptId: attemptId,
        beautifyStartedAt: Date.now(),
      }),
    )

    const args = {
      ...observation,
      attemptId,
      recipeId,
      sourceStorageId: imageStorageId,
      failureKind: 'no_image' as const,
      error: 'Réponse en texte, sans image',
    }
    await expect(
      t.mutation(internal.beautify.recordBeautifyFailure, args),
    ).resolves.toBe(true)
    // Replayed, it journals nothing more: the call was billed once.
    await expect(
      t.mutation(internal.beautify.recordBeautifyFailure, args),
    ).resolves.toBe(false)

    const [recipe, attempts] = await t.run(async (ctx) => [
      await ctx.db.get('recipes', recipeId),
      await ctx.db.query('beautifyAttempts').collect(),
    ])
    expect(recipe).toMatchObject({
      beautifyStatus: 'failed',
      beautifyError: 'Réponse en texte, sans image',
    })
    // Cleared, not merely stale: the lease has to be gone or the recipe stays blocked.
    expect(recipe?.beautifyAttemptId).toBeUndefined()
    expect(recipe?.beautifyStartedAt).toBeUndefined()
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      outcome: 'discarded',
      failureKind: 'no_image',
    })
  })
})
