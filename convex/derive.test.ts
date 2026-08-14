// @vitest-environment node
//
// The only test file that has to load a native binary. Node is also the *faithful* environment
// here: `derive.ts` is a `"use node"` action, so production runs it under Node, not under the
// edge runtime `vitest.config.ts` sets globally for everything else.
import { convexTest } from 'convex-test'
import sharp from 'sharp'
import { beforeEach, describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { MAX_DERIVATION_ATTEMPTS } from './derivations'
import { DERIVATIVE_HEIGHT } from './derive'
import schema from './schema'
import { registerComponents } from '../test/convexComponents'

const modules = import.meta.glob('./**/*.ts')

function setup() {
  const t = convexTest(schema, modules)
  registerComponents(t)
  return t
}

type Ctx = ReturnType<typeof setup>

/** A real encoded image, built rather than committed: the fixture is the shape, not the bytes. */
async function png({
  width,
  height,
  orientation,
}: {
  width: number
  height: number
  orientation?: number
}): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  })
  return (orientation ? image.withMetadata({ orientation }) : image)
    .jpeg()
    .toBuffer()
}

async function storeImage(t: Ctx, bytes: Buffer): Promise<Id<'_storage'>> {
  return t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    ),
  )
}

async function recipeWithPhoto(
  t: Ctx,
  sourceStorageId: Id<'_storage'>,
): Promise<Id<'recipes'>> {
  return t.run((ctx) =>
    ctx.db.insert('recipes', {
      title: 'Clafoutis',
      type: 'dessert' as const,
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
      searchText: 'clafoutis',
      status: 'review' as const,
      imageStorageId: sourceStorageId,
      hasIllustration: true,
      beautifiedAccepted: false,
      beautifyStatus: 'idle' as const,
    }),
  )
}

/** A rendition as one comparable string, so an unexpected failure reports its cause, not its shape. */
function renditionShape(rendition: Doc<'recipes'>['imageRendition']): string {
  if (!rendition) return 'absent'
  return rendition.status === 'failed'
    ? `failed: ${rendition.error}`
    : rendition.status
}

async function renditionOf(
  t: Ctx,
  recipeId: Id<'recipes'>,
): Promise<Doc<'recipes'>['imageRendition']> {
  const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
  return recipe?.imageRendition
}

/** A Blob cannot cross the `t.run` boundary, so the bytes are read on the inside. */
async function storedBytes(
  t: Ctx,
  storageId: Id<'_storage'>,
): Promise<{ bytes: Buffer; type: string }> {
  const read = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(storageId)
    if (!blob) throw new Error('blob missing')
    // An ArrayBuffer crosses the boundary; a Blob or a Uint8Array does not.
    return { bytes: await blob.arrayBuffer(), type: blob.type }
  })
  return { bytes: Buffer.from(read.bytes), type: read.type }
}

async function ready(t: Ctx, recipeId: Id<'recipes'>) {
  const rendition = await renditionOf(t, recipeId)
  if (rendition?.status !== 'ready') {
    throw new Error(`expected a ready rendition, got ${rendition?.status}`)
  }
  return rendition
}

async function derive(t: Ctx, recipeId: Id<'recipes'>, source: Id<'_storage'>) {
  await t.action(internal.derive.deriveRendition, {
    recipeId,
    slot: 'original',
    sourceStorageId: source,
  })
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = 'test-secret'
})

describe('deriveRendition', () => {
  test('sharp loads and encodes a WebP at the display height', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 864, height: 1184 }))
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)

    const rendition = await ready(t, recipeId)
    expect(rendition.height).toBe(DERIVATIVE_HEIGHT)
    // 864/1184 of 400, rounded — the portrait geometry measured in production.
    expect(rendition.width).toBe(292)
    expect(rendition.sourceWidth).toBe(864)
    expect(rendition.sourceHeight).toBe(1184)

    const derived = await storedBytes(t, rendition.storageId)
    expect(derived.type).toBe('image/webp')
    expect(await sharp(derived.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 292,
      height: 400,
    })
  })

  test('the derivative weighs a fraction of the source it replaces', async () => {
    const t = setup()
    const sourceBytes = await png({ width: 864, height: 1184 })
    const source = await storeImage(t, sourceBytes)
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)

    const rendition = await ready(t, recipeId)
    const derived = await storedBytes(t, rendition.storageId)
    expect(derived.bytes.byteLength).toBeLessThan(sourceBytes.byteLength)
  })

  test('a source smaller than the box is not blown up', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 150, height: 200 }))
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)

    const rendition = await ready(t, recipeId)
    expect(rendition.width).toBe(150)
    expect(rendition.height).toBe(200)
  })

  // The test that would have caught the first draft's mistake: `sniffImageHeader()` and
  // `metadata()` both report the *encoded* size, which an EXIF-transposing orientation makes wrong.
  test('an EXIF-transposed source is measured as it will be displayed', async () => {
    const t = setup()
    // Encoded 400×800, orientation 6 ⇒ displayed 800×400, a landscape.
    const source = await storeImage(
      t,
      await png({ width: 400, height: 800, orientation: 6 }),
    )
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)

    const rendition = await ready(t, recipeId)
    expect(rendition.sourceWidth).toBe(800)
    expect(rendition.sourceHeight).toBe(400)
    // And the derivative's own dimensions describe the rotated output, not the input.
    expect(rendition.height).toBe(DERIVATIVE_HEIGHT)
    expect(rendition.width).toBe(800)
  })

  test('an undecodable source is recorded as failed, with its cause', async () => {
    const t = setup()
    const source = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' }),
      ),
    )
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)

    const rendition = await renditionOf(t, recipeId)
    expect(rendition?.status).toBe('failed')
    if (rendition?.status !== 'failed') throw new Error('unreachable')
    expect(rendition.error).not.toBe('')
    expect(rendition.sourceStorageId).toBe(source)
  })

  test('a missing source blob fails without leaving a rendition claiming success', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 100, height: 100 }))
    const recipeId = await recipeWithPhoto(t, source)
    await t.run((ctx) => ctx.storage.delete(source))

    await derive(t, recipeId, source)

    expect((await renditionOf(t, recipeId))?.status).toBe('failed')
  })

  test('a source replaced mid-flight leaves the recipe untouched', async () => {
    const t = setup()
    const oldSource = await storeImage(
      t,
      await png({ width: 864, height: 1184 }),
    )
    const newSource = await storeImage(
      t,
      await png({ width: 100, height: 100 }),
    )
    const recipeId = await recipeWithPhoto(t, newSource)

    // The action was started for `oldSource`; the slot already points elsewhere.
    await derive(t, recipeId, oldSource)

    expect(await renditionOf(t, recipeId)).toBeUndefined()
  })

  test('deriving twice leaves exactly one derivative behind', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 864, height: 1184 }))
    const recipeId = await recipeWithPhoto(t, source)

    await derive(t, recipeId, source)
    const first = await ready(t, recipeId)
    await derive(t, recipeId, source)
    const second = await ready(t, recipeId)

    const surviving = await t.run(async (ctx) => {
      const blobs = await ctx.db.system.query('_storage').collect()
      return blobs.map((blob) => blob._id)
    })
    expect(surviving).toContain(second.storageId)
    expect(surviving).toContain(source)
    if (first.storageId !== second.storageId) {
      expect(surviving).not.toContain(first.storageId)
    }
    // The source plus one derivative, never two.
    expect(surviving).toHaveLength(2)
  })
})

describe('deriveMissing', () => {
  test('derives both slots of a recipe whose beautification hides its original, then converges', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 864, height: 1184 }))
    const candidate = await storeImage(
      t,
      await png({ width: 900, height: 600 }),
    )
    const recipeId = await t.run((ctx) =>
      ctx.db.insert('recipes', {
        title: 'Clafoutis',
        type: 'dessert' as const,
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'clafoutis',
        status: 'review' as const,
        imageStorageId: source,
        beautifiedStorageId: candidate,
        beautifiedAccepted: true,
        hasIllustration: true,
        beautifyStatus: 'idle' as const,
      }),
    )

    // Enumeration is the subject, and the two renderings then run one at a time. Draining both
    // through the scheduler would have two actions call `ctx.storage.store` concurrently, and
    // `convex-test` keeps a single shared write stack for the whole in-memory database
    // (`_addWrite` throws "Write outside of transaction" when one action pops the frame the other is
    // writing into). Production shares no transaction between two actions, so serialising here is
    // faithful to what this test certifies rather than a workaround for a real race.
    const pending = await t.query(internal.derivations.listPendingDerivations, {
      limit: 10,
    })
    expect(pending).toEqual({
      slots: [
        { recipeId, slot: 'original', sourceStorageId: source },
        { recipeId, slot: 'beautified', sourceStorageId: candidate },
      ],
      isDone: true,
    })
    for (const slot of pending.slots) {
      await t.action(internal.derive.deriveRendition, slot)
    }

    // Flattened to strings rather than asserted as objects: vitest elides a nested diff, so a
    // `failed` rendition would report "not ready" and swallow the cause it carries.
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect({
      original: renditionShape(recipe?.imageRendition),
      beautified: renditionShape(recipe?.beautifiedRendition),
    }).toEqual({ original: 'ready', beautified: 'ready' })

    // Converged: nothing is left pending.
    expect(
      await t.query(internal.derivations.listPendingDerivations, { limit: 10 }),
    ).toEqual({ slots: [], isDone: true })
  })

  test('does not loop for ever on an image sharp cannot decode', async () => {
    const t = setup()
    const source = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }),
      ),
    )
    const recipeId = await recipeWithPhoto(t, source)

    // An undecodable image is retried while it is under the attempt ceiling — a failure could always
    // have been transient — so what has to be certified is that the retries *end*, not that they end
    // on the first pass. Driven through the action directly rather than through the backfill: what is
    // under test is the selection rule and the attempt budget, and routing it through the pool would
    // make this assert the pool's wake-up timing instead. The pool has its own test above.
    let passes = 0
    for (;;) {
      const pending = await t.query(
        internal.derivations.listPendingDerivations,
        { limit: 10 },
      )
      if (pending.slots.length === 0) break
      for (const slot of pending.slots) {
        await t.action(internal.derive.deriveRendition, slot)
      }
      passes += 1
      if (passes > MAX_DERIVATION_ATTEMPTS) throw new Error('does not converge')
    }

    expect(passes).toBe(MAX_DERIVATION_ATTEMPTS)
    expect(await renditionOf(t, recipeId)).toMatchObject({
      status: 'failed',
      attempts: MAX_DERIVATION_ATTEMPTS,
    })

    // And it is still reachable on demand, through the migration that ignores the spent budget.
    expect(
      await t.query(internal.derivations.listPendingDerivations, {
        limit: 10,
        retryFailed: true,
      }),
    ).toEqual({
      slots: [{ recipeId, slot: 'original', sourceStorageId: source }],
      isDone: true,
    })
  })

  /**
   * Falsifiable rather than decorative: a derivation that went through `scheduler.runAfter` leaves a
   * job named after `deriveRendition` in the app's own `_scheduled_functions`, and one that went
   * through the pool does not — the pool schedules its own worker inside the component. Reverting the
   * enqueue to a raw `runAfter` therefore fails this test.
   */
  test('the backfill enqueues on the pool instead of the raw scheduler', async () => {
    const t = setup()
    const source = await storeImage(t, await png({ width: 864, height: 1184 }))
    const recipeId = await recipeWithPhoto(t, source)

    await t.mutation(internal.migrations.backfillRenditions, {})
    const appJobs = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect()
      return jobs.map((job) => job.name)
    })
    expect(appJobs.filter((name) => name.includes('deriveRendition'))).toEqual(
      [],
    )

    // And the work still lands: the pool is carrying it, not swallowing it.
    await t.finishAllScheduledFunctions(() => {})
    expect(await renditionOf(t, recipeId)).toMatchObject({ status: 'ready' })
  })
})
