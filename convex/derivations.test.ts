import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { MAX_DERIVATION_ATTEMPTS } from './derivations'
import { withIllustration } from './lib/recipeWrites'
import { ILLUSTRATION_STAGE_MIGRATION } from './migrations'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const adminToken = 'test-secret'

beforeEach(() => {
  process.env.ADMIN_TOKEN = adminToken
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
})

function setup() {
  return convexTest(schema, modules)
}

type Ctx = ReturnType<typeof setup>

function pngBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

async function storeBlob(t: Ctx): Promise<Id<'_storage'>> {
  return t.run((ctx) =>
    ctx.storage.store(new Blob([pngBytes()], { type: 'image/png' })),
  )
}

async function newRecipe(t: Ctx, over: Record<string, unknown> = {}) {
  const fields = {
    title: 'Clafoutis',
    type: 'dessert' as const,
    ingredients: [],
    ingredientsInferred: false,
    steps: [],
    searchText: 'clafoutis',
    status: 'review' as const,
    beautifiedAccepted: false,
    beautifyStatus: 'idle' as const,
    ...over,
  }
  return t.run((ctx) =>
    ctx.db.insert('recipes', { ...fields, ...keysOf(fields) }),
  )
}

/**
 * The index keys, derived exactly as production derives them, so a fixture that sets
 * `imageStorageId` lands in the bucket the screen would really put it in — rather than in whatever
 * `hasIllustration` the test happened to hand-write.
 */
function keysOf(fields: Record<string, unknown>) {
  return withIllustration(
    {
      imageStorageId: fields.imageStorageId as Id<'_storage'> | undefined,
      beautifiedAccepted: Boolean(fields.beautifiedAccepted),
      noPhotoAvailable: Boolean(fields.noPhotoAvailable),
    },
    (fields.illustrationUpdatedAt as number | undefined) ?? Date.now(),
  )
}

/** The stage sections are not read until the backfill is done, so a test that reads them says so. */
async function markStagesDone(t: Ctx) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('migrations')
      .withIndex('by_name', (q) => q.eq('name', ILLUSTRATION_STAGE_MIGRATION))
      .first()
    if (existing) return
    await ctx.db.insert('migrations', {
      name: ILLUSTRATION_STAGE_MIGRATION,
      cursor: null,
      done: true,
      migrated: 0,
      updatedAt: Date.now(),
    })
  })
}

const ALL_OPEN = {
  toBeautify: 50,
  missing: 50,
  sourceHasNone: 50,
  done: 50,
} as const

async function listWork(
  t: Ctx,
  limits: Partial<typeof ALL_OPEN> & { stagesReady?: boolean } = {},
) {
  const { stagesReady = true, ...open } = limits
  if (stagesReady) await markStagesDone(t)
  return t.query(api.illustrations.listIllustrationWork, {
    adminToken,
    limits: { ...ALL_OPEN, ...open },
  })
}

function readyRendition(
  sourceStorageId: Id<'_storage'>,
  storageId: Id<'_storage'>,
) {
  return {
    status: 'ready' as const,
    sourceStorageId,
    sourceWidth: 864,
    sourceHeight: 1184,
    storageId,
    width: 292,
    height: 400,
  }
}

function failedRendition(sourceStorageId: Id<'_storage'>, attempts: number) {
  return {
    status: 'failed' as const,
    sourceStorageId,
    error: 'Input buffer contains unsupported image format',
    attempts,
  }
}

async function blobExists(t: Ctx, storageId: Id<'_storage'>): Promise<boolean> {
  return t.run(async (ctx) => {
    const metadata = await ctx.db.system.get('_storage', storageId)
    return metadata !== null
  })
}

async function recipeOf(t: Ctx, recipeId: Id<'recipes'>) {
  const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
  if (!recipe) throw new Error('recipe vanished')
  return recipe
}

describe('finalizeDerivation', () => {
  test('adopts a derivative made from the blob the slot still holds', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
    })

    const outcome = await t.mutation(internal.derivations.finalizeDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: source,
      storageId: derivative,
      sourceWidth: 864,
      sourceHeight: 1184,
      width: 292,
      height: 400,
    })

    expect(outcome).toBe('adopted')
    const recipe = await recipeOf(t, recipeId)
    expect(recipe.imageRendition).toMatchObject({
      status: 'ready',
      sourceStorageId: source,
      storageId: derivative,
      width: 292,
      height: 400,
    })
  })

  test('discards a derivative whose source was replaced while it was rendering', async () => {
    const t = setup()
    const oldSource = await storeBlob(t)
    const newSource = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: newSource,
      hasIllustration: true,
    })

    const outcome = await t.mutation(internal.derivations.finalizeDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: oldSource,
      storageId: derivative,
      sourceWidth: 864,
      sourceHeight: 1184,
      width: 292,
      height: 400,
    })

    expect(outcome).toBe('discarded')
    expect(await recipeOf(t, recipeId)).not.toHaveProperty('imageRendition')
    expect(await blobExists(t, derivative)).toBe(false)
  })

  test('a replay of the same derivation writes nothing and destroys nothing', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: readyRendition(source, derivative),
    })

    const outcome = await t.mutation(internal.derivations.finalizeDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: source,
      storageId: derivative,
      sourceWidth: 864,
      sourceHeight: 1184,
      width: 292,
      height: 400,
    })

    expect(outcome).toBe('adopted')
    expect(await blobExists(t, derivative)).toBe(true)
  })

  test('a second run replaces the rendition and destroys the derivative it supersedes', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const first = await storeBlob(t)
    const second = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: readyRendition(source, first),
    })

    await t.mutation(internal.derivations.finalizeDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: source,
      storageId: second,
      sourceWidth: 864,
      sourceHeight: 1184,
      width: 292,
      height: 400,
    })

    expect(await blobExists(t, first)).toBe(false)
    expect(await blobExists(t, second)).toBe(true)
  })
})

describe('failDerivation', () => {
  test('records the cause, distinguishing it from never attempted', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
    })

    const written = await t.mutation(internal.derivations.failDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: source,
      error: 'Input buffer contains unsupported image format',
    })

    expect(written).toBe(true)
    const recipe = await recipeOf(t, recipeId)
    expect(recipe.imageRendition).toMatchObject({
      status: 'failed',
      sourceStorageId: source,
      error: 'Input buffer contains unsupported image format',
    })
  })

  // The guard everyone forgets: reads stay safe through the compare-and-set, but a stale failure
  // would make the work list report a photo that no longer exists.
  test('writes nothing when the source was replaced while sharp was failing', async () => {
    const t = setup()
    const oldSource = await storeBlob(t)
    const newSource = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: newSource,
      hasIllustration: true,
    })

    const written = await t.mutation(internal.derivations.failDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: oldSource,
      error: 'boom',
    })

    expect(written).toBe(false)
    expect(await recipeOf(t, recipeId)).not.toHaveProperty('imageRendition')
  })

  // Two runs can overlap on one slot — an upload schedules its own derivation while a backfill pass
  // selects the same slot. If the loser wrote its failure, a working derivative would become an
  // orphan blob and the storefront would go quietly back to the full-weight source.
  test('refuses to overwrite a derivative that already works', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: readyRendition(source, derivative),
    })

    const written = await t.mutation(internal.derivations.failDerivation, {
      recipeId,
      slot: 'original',
      sourceStorageId: source,
      error: 'a second run broke after the first had succeeded',
    })

    expect(written).toBe(false)
    expect(await recipeOf(t, recipeId)).toMatchObject({
      imageRendition: { status: 'ready', storageId: derivative },
    })
    expect(await blobExists(t, derivative)).toBe(true)
  })

  test('accumulates attempts across runs, and starts over on a new source', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
    })
    const fail = (sourceStorageId: Id<'_storage'>) =>
      t.mutation(internal.derivations.failDerivation, {
        recipeId,
        slot: 'original',
        sourceStorageId,
        error: 'boom',
      })

    await fail(source)
    await fail(source)
    expect(await recipeOf(t, recipeId)).toMatchObject({
      imageRendition: { attempts: 2 },
    })

    // Replacing the photo makes it a different question, so the budget resets rather than inheriting
    // the previous image's failures.
    const replacement = await storeBlob(t)
    await t.run((ctx) =>
      ctx.db.patch(recipeId, { imageStorageId: replacement }),
    )
    await fail(replacement)
    expect(await recipeOf(t, recipeId)).toMatchObject({
      imageRendition: { attempts: 1, sourceStorageId: replacement },
    })
  })
})

describe('listPendingDerivations', () => {
  test('enumerates both slots, whichever one is on screen', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const candidate = await storeBlob(t)
    // An accepted beautification hides the original — which unpublishing would put back on screen,
    // so it needs a derivative just as much.
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      beautifiedStorageId: candidate,
      beautifiedAccepted: true,
      hasIllustration: true,
    })

    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })

    expect(pending.slots).toEqual(
      expect.arrayContaining([
        { recipeId, slot: 'original', sourceStorageId: source },
        { recipeId, slot: 'beautified', sourceStorageId: candidate },
      ]),
    )
    expect(pending.slots).toHaveLength(2)
    expect(pending.isDone).toBe(true)
  })

  test('skips a slot whose rendition is ready and still matches its source', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: readyRendition(source, derivative),
    })

    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })
    expect(pending.slots).toEqual([])
  })

  test('selects a rendition whose source no longer matches', async () => {
    const t = setup()
    const oldSource = await storeBlob(t)
    const newSource = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: newSource,
      hasIllustration: true,
      imageRendition: readyRendition(oldSource, derivative),
    })

    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })
    expect(pending.slots).toEqual([
      { recipeId, slot: 'original', sourceStorageId: newSource },
    ])
  })

  // Without this, "repeat until zero" never converges on an image sharp cannot decode.
  // The whole point of counting: a failure that had nothing to do with the bytes — a native library
  // that did not load — must not park the photo at full weight until someone notices.
  test('retries a failed rendition that is still under the attempt ceiling', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: failedRendition(source, MAX_DERIVATION_ATTEMPTS - 1),
    })

    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })
    expect(pending.slots).toEqual([
      { recipeId, slot: 'original', sourceStorageId: source },
    ])
  })

  test('leaves an exhausted rendition alone unless retryFailed is asked for', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: failedRendition(source, MAX_DERIVATION_ATTEMPTS),
    })

    const skipped = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })
    expect(skipped.slots).toEqual([])

    const retried = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
      retryFailed: true,
    })
    expect(retried.slots).toEqual([
      { recipeId, slot: 'original', sourceStorageId: source },
    ])
  })

  test('reports that it stopped on the limit rather than on the end of the corpus', async () => {
    const t = setup()
    for (let i = 0; i < 3; i += 1) {
      await newRecipe(t, {
        title: `Recette ${i}`,
        imageStorageId: await storeBlob(t),
        hasIllustration: true,
      })
    }

    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 2,
    })
    expect(pending.slots).toHaveLength(2)
    expect(pending.isDone).toBe(false)
  })
})

describe('rendition lifecycle on the paths that remove a source', () => {
  test('detaching the photo destroys its derivative and clears the field', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: readyRendition(source, derivative),
    })

    await t.mutation(api.illustrations.detachIllustration, {
      adminToken,
      recipeId,
    })

    expect(await blobExists(t, derivative)).toBe(false)
    expect(await recipeOf(t, recipeId)).not.toHaveProperty('imageRendition')
  })

  test('deleting an unpublished candidate destroys its derivative', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const candidate = await storeBlob(t)
    const derivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      beautifiedStorageId: candidate,
      hasIllustration: true,
      beautifiedRendition: readyRendition(candidate, derivative),
    })

    await t.mutation(api.illustrations.deleteUnpublishedCandidate, {
      adminToken,
      recipeId,
    })

    expect(await blobExists(t, derivative)).toBe(false)
    expect(await recipeOf(t, recipeId)).not.toHaveProperty(
      'beautifiedRendition',
    )
  })

  // The pre-existing leak: the row went away and every blob it referenced stayed behind for ever.
  test('deleting a recipe destroys its sources and both derivatives', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const candidate = await storeBlob(t)
    const sourceDerivative = await storeBlob(t)
    const candidateDerivative = await storeBlob(t)
    const recipeId = await newRecipe(t, {
      imageStorageId: source,
      beautifiedStorageId: candidate,
      hasIllustration: true,
      imageRendition: readyRendition(source, sourceDerivative),
      beautifiedRendition: readyRendition(candidate, candidateDerivative),
    })

    await t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId })

    for (const storageId of [
      source,
      candidate,
      sourceDerivative,
      candidateDerivative,
    ]) {
      expect(await blobExists(t, storageId)).toBe(false)
    }
  })
})

describe('what the admin work list reports about renditions', () => {
  test('reports each slot independently, with the cause of the one that failed', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const candidate = await storeBlob(t)
    const candidateDerivative = await storeBlob(t)
    await newRecipe(t, {
      imageStorageId: source,
      beautifiedStorageId: candidate,
      hasIllustration: true,
      // The original refused, the candidate succeeded: a single row-level state could not say which.
      imageRendition: failedRendition(source, 1),
      beautifiedRendition: readyRendition(candidate, candidateDerivative),
    })

    const work = await listWork(t)

    // A candidate that is not accepted leaves work to do, so the row sits in "À embellir".
    expect(work.toBeautify.rows).toMatchObject([
      {
        originalRendition: {
          state: 'failed',
          error: 'Input buffer contains unsupported image format',
        },
        candidateRendition: { state: 'ready', error: null },
      },
    ])
  })

  test('says nothing about a slot that holds no blob', async () => {
    const t = setup()
    await newRecipe(t, { hasIllustration: false })

    const work = await listWork(t)

    expect(work.missing.rows).toMatchObject([
      { originalRendition: null, candidateRendition: null },
    ])
  })

  // The measured worst consumer of the product: 50 rows × 2 full-format images in one screen.
  test('inventory buckets serve the derivative, the arbitration bucket the full plate', async () => {
    const t = setup()
    const source = await storeBlob(t)
    const derivative = await storeBlob(t)
    const rendition = readyRendition(source, derivative)

    const inventoried = await newRecipe(t, {
      title: 'Inventoriée',
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: rendition,
    })
    await newRecipe(t, {
      title: 'À arbitrer',
      imageStorageId: source,
      hasIllustration: true,
      imageRendition: rendition,
      beautifyStatus: 'review' as const,
      beautifyAttemptId: 'attempt-1',
    })

    const work = await listWork(t)
    const derivativeUrl = await t.run((ctx) => ctx.storage.getUrl(derivative))
    const sourceUrl = await t.run((ctx) => ctx.storage.getUrl(source))

    expect(work.toBeautify.rows).toEqual([
      expect.objectContaining({
        id: inventoried,
        thumbnails: true,
        originalUrl: derivativeUrl,
      }),
    ])
    expect(work.active.rows).toEqual([
      expect.objectContaining({
        title: 'À arbitrer',
        thumbnails: false,
        originalUrl: sourceUrl,
      }),
    ])
    // The partition, asserted where an earlier design documented the opposite as legitimate: a
    // recipe awaiting arbitration used to appear in both lists, which on a screen that shows both
    // sections open means the same row twice — and two gesture controls on one registry key.
    expect(work.toBeautify.rows.map((row) => row.title)).not.toContain(
      'À arbitrer',
    )
  })
})
