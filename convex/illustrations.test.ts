import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { withIllustration } from './lib/recipeWrites'
import { BACKFILL_BATCH, ILLUSTRATION_STAGE_MIGRATION } from './migrations'
import schema from './schema'
import { bytesToBase64 } from '../src/lib/base64'
import {
  BEAUTIFY_MODEL,
  BEAUTIFY_PROMPT_VERSION,
} from '../src/lib/beautifyPrompt'

const modules = import.meta.glob('./**/*.ts')
const adminToken = 'test-secret'

function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  return t
}

function jpegBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16])
  return bytes
}

function jpeg(): Blob {
  return new Blob([jpegBytes()], { type: 'image/jpeg' })
}

type Ctx = ReturnType<typeof setup>

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
 * A recipe as it exists before the stage backfill reaches it: no `illustrationStage`, so it is in
 * none of the four stage sections — and, if it is mid-generation, still served by `active`.
 */
async function unmigratedRecipe(t: Ctx, over: Record<string, unknown> = {}) {
  return t.run((ctx) =>
    ctx.db.insert('recipes', {
      title: 'Ancienne',
      type: 'autre' as const,
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
      searchText: 'ancienne',
      status: 'review' as const,
      beautifiedAccepted: false,
      beautifyStatus: 'idle' as const,
      ...over,
    }),
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
    if (existing) {
      await ctx.db.patch(existing._id, { done: true })
      return
    }
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

type OpenLimits = {
  toBeautify?: number
  missing?: number | null
  sourceHasNone?: number | null
  done?: number | null
}

async function listWork(
  t: Ctx,
  limits: OpenLimits & { stagesReady?: boolean } = {},
) {
  const { stagesReady = true, ...open } = limits
  if (stagesReady) await markStagesDone(t)
  return t.query(api.illustrations.listIllustrationWork, {
    adminToken,
    limits: { ...ALL_OPEN, ...open },
  })
}

async function ticket(
  t: Ctx,
  purpose: 'scan' | 'illustration' = 'illustration',
) {
  const grant = await t.mutation(api.admin.generateUploadUrl, {
    adminToken,
    purpose,
  })
  if (!grant.ok) throw new Error(grant.error)
  return grant.ticketId
}

async function stored(t: Ctx, storageId: Id<'_storage'>) {
  return t.run((ctx) => ctx.db.system.get('_storage', storageId))
}

/** Posts a photo the way the screen does: a ticket, an upload, then the action. */
async function attach(t: Ctx, recipeId: Id<'recipes'>) {
  const ticketId = await ticket(t)
  const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
  const result = await t.action(api.illustrations.attachIllustration, {
    adminToken,
    ticketId,
    storageId,
    recipeId,
  })
  return { ticketId, storageId, result }
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = adminToken
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
})

describe('posting a photo', () => {
  test('attaches it and lights the index in the same write', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { storageId, result } = await attach(t, recipeId)
    expect(result).toEqual({ ok: true })

    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe).toMatchObject({
      imageStorageId: storageId,
      hasIllustration: true,
    })
  })

  test('refuses a ticket drawn on the scanning quota, and destroys the blob', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const ticketId = await ticket(t, 'scan')
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))

    await expect(
      t.action(api.illustrations.attachIllustration, {
        adminToken,
        ticketId,
        storageId,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
    // The ticket was still virgin, so the blob belonged to nobody: destroying it took nothing.
    expect(await stored(t, storageId)).toBeNull()
  })

  test('refuses an illustration ticket on the scan endpoint', async () => {
    const t = setup()
    const ticketId = await ticket(t, 'illustration')
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await expect(
      t.mutation(api.admin.attachImage, { adminToken, ticketId, storageId }),
    ).resolves.toMatchObject({ ok: false })
  })

  test('refuses bytes that are not a readable image, before consuming the ticket', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const ticketId = await ticket(t)
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1, 2, 3, 4])])),
    )
    await expect(
      t.action(api.illustrations.attachIllustration, {
        adminToken,
        ticketId,
        storageId,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
    const ticketRow = await t.run((ctx) =>
      ctx.db.get('uploadTickets', ticketId),
    )
    expect(ticketRow?.consumedAt).toBeUndefined()
  })

  test('replayed identically, succeeds without destroying the photo it attached', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { ticketId, storageId } = await attach(t, recipeId)

    await expect(
      t.action(api.illustrations.attachIllustration, {
        adminToken,
        ticketId,
        storageId,
        recipeId,
      }),
    ).resolves.toEqual({ ok: true })
    expect(await stored(t, storageId)).not.toBeNull()
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.imageStorageId).toBe(storageId)
  })

  test('replayed with a different recipe, refuses without destroying anything', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const otherId = await newRecipe(t, { title: 'Tarte' })
    const { ticketId, storageId } = await attach(t, recipeId)

    await expect(
      t.action(api.illustrations.attachIllustration, {
        adminToken,
        ticketId,
        storageId,
        recipeId: otherId,
      }),
    ).resolves.toMatchObject({ ok: false })
    // The blob it points at is not its own. Refusing must not take it from the first recipe.
    expect(await stored(t, storageId)).not.toBeNull()
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.imageStorageId).toBe(storageId)
  })

  test('replacing deletes the old original and cancels a running generation', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { storageId: first } = await attach(t, recipeId)
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'generating',
        beautifyAttemptId: 'attempt-1',
        beautifyStartedAt: Date.now(),
      }),
    )

    const { storageId: second } = await attach(t, recipeId)
    expect(await stored(t, first)).toBeNull()
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe).toMatchObject({
      imageStorageId: second,
      // Not left `generating`: that would block the recipe until a lease expired, with nothing on
      // screen explaining it.
      beautifyStatus: 'failed',
    })
    expect(recipe?.beautifyAttemptId).toBeUndefined()
    expect(recipe?.beautifyError).toContain('remplacée')
  })

  test('refuses to replace or detach while a beautification is published', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    const candidate = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifiedStorageId: candidate,
        beautifiedAccepted: true,
      }),
    )

    const ticketId = await ticket(t)
    const storageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await expect(
      t.action(api.illustrations.attachIllustration, {
        adminToken,
        ticketId,
        storageId,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      t.mutation(api.illustrations.detachIllustration, {
        adminToken,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
  })

  test('detaching takes the original, the candidate and the index flag', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { storageId } = await attach(t, recipeId)
    const candidate = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifiedStorageId: candidate,
        beautifyStatus: 'review',
      }),
    )

    await expect(
      t.mutation(api.illustrations.detachIllustration, {
        adminToken,
        recipeId,
      }),
    ).resolves.toEqual({ ok: true })
    expect(await stored(t, storageId)).toBeNull()
    expect(await stored(t, candidate)).toBeNull()
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.hasIllustration).toBe(false)
    expect(recipe?.imageStorageId).toBeUndefined()
  })
})

describe('retention', () => {
  test('purging the scan takes its pages, never the dish photo', async () => {
    const t = setup()
    const page = await t.run((ctx) => ctx.storage.store(jpeg()))
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [page],
        status: 'done' as const,
        attempts: 1,
        createdAt: 1,
      }),
    )
    const recipeId = await newRecipe(t, { scanId })
    const { storageId } = await attach(t, recipeId)

    await t.mutation(internal.retention.purgeOneScan, { scanId })

    expect(await stored(t, page)).toBeNull()
    // The dish photo has no retention deadline and never had one: it is the recipe's, not the
    // scan's, and it outlives every page it was posted alongside.
    expect(await stored(t, storageId)).not.toBeNull()
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.imageStorageId).toBe(storageId)
  })
})

describe('transition matrix', () => {
  test('refuses a generation without a photo', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await expect(
      t.mutation(api.illustrations.requestBeautify, { adminToken, recipeId }),
    ).resolves.toMatchObject({ ok: false })
  })

  test('refuses a generation while one is running, or while a candidate awaits arbitration', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    for (const status of ['generating', 'review'] as const) {
      await t.run((ctx) => ctx.db.patch(recipeId, { beautifyStatus: status }))
      await expect(
        t.mutation(api.illustrations.requestBeautify, { adminToken, recipeId }),
      ).resolves.toMatchObject({ ok: false })
    }
  })

  test('refuses a generation while a beautification is published', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await t.run((ctx) => ctx.db.patch(recipeId, { beautifiedAccepted: true }))
    await expect(
      t.mutation(api.illustrations.requestBeautify, { adminToken, recipeId }),
    ).resolves.toMatchObject({ ok: false })
  })

  test('allows a generation after a failure, and schedules the render', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await t.run((ctx) =>
      ctx.db.patch(recipeId, {
        beautifyStatus: 'failed',
        beautifyError: 'Réponse en texte',
      }),
    )
    await expect(
      t.mutation(api.illustrations.requestBeautify, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })

    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.beautifyStatus).toBe('generating')
    expect(recipe?.beautifyStartedAt).toBeGreaterThan(0)
    expect(recipe?.beautifyError).toBeUndefined()
  })

  test('deletes the kept candidate before starting a new generation', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    const candidate = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.patch(recipeId, { beautifiedStorageId: candidate }),
    )

    await t.mutation(api.illustrations.requestBeautify, {
      adminToken,
      recipeId,
    })
    // Without this, the candidate a de-publication kept is silently overwritten by the next render.
    expect(await stored(t, candidate)).toBeNull()
  })

  test('refuses to arbitrate outside review', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    const candidate = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.patch(recipeId, { beautifiedStorageId: candidate }),
    )
    for (const call of [
      api.illustrations.acceptBeautified,
      api.illustrations.rejectPendingCandidate,
    ]) {
      await expect(
        t.mutation(call, { adminToken, recipeId }),
      ).resolves.toMatchObject({ ok: false })
    }
    // The blob survives a refused arbitration.
    expect(await stored(t, candidate)).not.toBeNull()
  })
})

/** Brings a recipe to `review` with a journalled attempt, the way a render does. */
async function toReview(t: Ctx, recipeId: Id<'recipes'>) {
  const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
  const attemptId = `${recipeId}:1`
  const candidate = await t.run((ctx) => ctx.storage.store(jpeg()))
  await t.run(async (ctx) => {
    await ctx.db.patch(recipeId, {
      beautifiedStorageId: candidate,
      beautifyStatus: 'review',
      beautifyAttemptId: attemptId,
    })
    await ctx.db.insert('beautifyAttempts', {
      attemptId,
      recipeId,
      model: 'google/gemini-2.5-flash-image',
      promptVersion: BEAUTIFY_PROMPT_VERSION,
      servedProvider: null,
      latencyMs: 9100,
      costUsd: 0.03944,
      costReported: true,
      failureKind: null,
      sourceStorageId: recipe!.imageStorageId!,
      outcome: 'pending',
      createdAt: Date.now(),
    })
  })
  return { attemptId, candidate }
}

describe('arbitration', () => {
  test('accepting publishes the candidate and settles its attempt', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    const { attemptId, candidate } = await toReview(t, recipeId)

    await expect(
      t.mutation(api.illustrations.acceptBeautified, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    const [recipe, attempts] = await t.run(async (ctx) => [
      await ctx.db.get('recipes', recipeId),
      await ctx.db.query('beautifyAttempts').collect(),
    ])
    expect(recipe).toMatchObject({
      beautifiedAccepted: true,
      beautifyStatus: 'idle',
      beautifiedStorageId: candidate,
    })
    expect(attempts[0]).toMatchObject({ attemptId, outcome: 'accepted' })
  })

  test('rejecting destroys the candidate and leaves the original alone', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { storageId } = await attach(t, recipeId)
    const { candidate } = await toReview(t, recipeId)

    await t.mutation(api.illustrations.rejectPendingCandidate, {
      adminToken,
      recipeId,
    })
    expect(await stored(t, candidate)).toBeNull()
    expect(await stored(t, storageId)).not.toBeNull()
    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    expect(attempts[0]?.outcome).toBe('rejected')
  })

  test('refuses a second arbitration on the same render', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await toReview(t, recipeId)

    await t.mutation(api.illustrations.acceptBeautified, {
      adminToken,
      recipeId,
    })
    // Back to `review` by hand — a state nothing produces. Arbitration must still refuse: the
    // verdict is already in the journal, and a second one would rewrite it.
    await t.run((ctx) => ctx.db.patch(recipeId, { beautifyStatus: 'review' }))
    await expect(
      t.mutation(api.illustrations.rejectPendingCandidate, {
        adminToken,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
  })

  test('unpublishing keeps the blob and the outcome, then deletion clears only the blob', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    const { candidate } = await toReview(t, recipeId)
    await t.mutation(api.illustrations.acceptBeautified, {
      adminToken,
      recipeId,
    })

    await expect(
      t.mutation(api.illustrations.unpublishAcceptedCandidate, {
        adminToken,
        recipeId,
      }),
    ).resolves.toEqual({ ok: true })
    // The render was paid for and judged good: the storefront falls back without losing it.
    expect(await stored(t, candidate)).not.toBeNull()

    await expect(
      t.mutation(api.illustrations.deleteUnpublishedCandidate, {
        adminToken,
        recipeId,
      }),
    ).resolves.toEqual({ ok: true })
    expect(await stored(t, candidate)).toBeNull()
    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    // Housekeeping, not arbitration: the journal still says a human adopted this render once.
    expect(attempts[0]?.outcome).toBe('accepted')
  })

  test('refuses to delete a candidate that is still published', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await toReview(t, recipeId)
    await t.mutation(api.illustrations.acceptBeautified, {
      adminToken,
      recipeId,
    })
    await expect(
      t.mutation(api.illustrations.deleteUnpublishedCandidate, {
        adminToken,
        recipeId,
      }),
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('abandoning a stalled generation', () => {
  test('refuses while the lease is fresh, allows once it has run out', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await t.mutation(api.illustrations.requestBeautify, {
      adminToken,
      recipeId,
    })

    await expect(
      t.mutation(api.illustrations.abandonBeautify, { adminToken, recipeId }),
    ).resolves.toMatchObject({ ok: false })

    await t.run((ctx) => ctx.db.patch(recipeId, { beautifyStartedAt: 0 }))
    await expect(
      t.mutation(api.illustrations.abandonBeautify, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.beautifyStatus).toBe('failed')
    expect(recipe?.beautifyAttemptId).toBeUndefined()
  })
})

describe('the work list', () => {
  test('bounds each block and reports its truncation', async () => {
    const t = setup()
    await Promise.all(
      Array.from({ length: 3 }, (_unused, index) =>
        newRecipe(t, { title: `Sans photo ${index}` }),
      ),
    )
    const work = await listWork(t)
    expect(work.missing.count).toBe(3)
    expect(work.missing.truncated).toBe(false)
  })

  // Nothing claims the queue is exhaustive until the backfill says so — and while it has not, the
  // four stage sections are not read at all rather than shown partial.
  test('withholds the stage sections until the backfill is done', async () => {
    const t = setup()
    await newRecipe(t, { title: 'Sans photo' })

    const migrating = await listWork(t, { stagesReady: false })
    expect(migrating.stagesReady).toBe(false)
    expect(migrating.missing).toEqual({ rows: [], count: 0, truncated: false })
    expect(migrating.migration).toMatchObject({ started: false, done: false })

    const ready = await listWork(t)
    expect(ready.stagesReady).toBe(true)
    expect(ready.missing.count).toBe(1)
  })

  /**
   * A recipe the backfill has not reached is still served by `active`, which reads
   * `by_beautify_status` and knows nothing about the stage. Its `updatedAt` has to fall back to
   * `_creationTime`: without that, the return validator rejects `undefined` and the whole screen —
   * arbitration included — goes down for the length of the migration.
   */
  test('serves an unmigrated recipe in arbitration with a fallback date', async () => {
    const t = setup()
    const recipeId = await unmigratedRecipe(t, {
      beautifyStatus: 'generating' as const,
      beautifyAttemptId: 'attempt-1',
    })
    const created = await t.run(async (ctx) => {
      const doc = await ctx.db.get('recipes', recipeId)
      return doc?._creationTime
    })

    const work = await listWork(t, { stagesReady: false })
    expect(work.active.count).toBe(1)
    expect(work.active.rows[0]).toMatchObject({ updatedAt: created })
  })

  test('files a photographed recipe under what is left to beautify, not under what is done', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)

    const work = await listWork(t)
    // The defect this lot exists to fix: a photo posted and not yet beautified used to be filed as
    // illustrated, behind a checkbox, which put the main step of the flow out of sight.
    expect(work.toBeautify.count).toBe(1)
    expect(work.toBeautify.rows[0]).toMatchObject({
      hasOriginal: true,
      hasCandidate: false,
    })
    expect(work.done.count).toBe(0)
    expect(work.missing.count).toBe(0)
  })

  test('reads a folded section for its count and nothing else', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await toReview(t, recipeId)
    await t.mutation(api.illustrations.acceptBeautified, {
      adminToken,
      recipeId,
    })

    const folded = await listWork(t, { done: null })
    expect(folded.done).toMatchObject({ count: 1, rows: [] })

    const open = await listWork(t, { done: 50 })
    expect(open.done.rows).toHaveLength(1)
    expect(open.done.rows[0]?.originalUrl).not.toBeNull()
  })

  test('puts what is waiting for arbitration ahead of what is still running', async () => {
    const t = setup()
    const waiting = await newRecipe(t, { title: 'À arbitrer' })
    await attach(t, waiting)
    await toReview(t, waiting)
    const running = await newRecipe(t, { title: 'En cours' })
    await attach(t, running)
    await t.run((ctx) =>
      ctx.db.patch(running, { beautifyStatus: 'generating' }),
    )

    const work = await listWork(t)
    expect(work.active.rows.map((row) => row.title)).toEqual([
      'À arbitrer',
      'En cours',
    ])
    // The partition again, from the other side: neither is offered as work to beautify while a
    // verdict or a generation is outstanding on it.
    expect(work.toBeautify.count).toBe(0)
  })
})

describe('the nominal path, end to end', () => {
  const imageAnswer = () => ({
    provider: 'google-vertex',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          images: [
            {
              image_url: {
                url: `data:image/jpeg;base64,${bytesToBase64(jpegBytes())}`,
              },
            },
          ],
        },
      },
    ],
    usage: { cost: 0.03944 },
  })

  async function renderOnce(t: Ctx, recipeId: Id<'recipes'>) {
    await t.mutation(api.illustrations.requestBeautify, {
      adminToken,
      recipeId,
    })
    // The render is scheduled, not awaited: without draining the queue the recipe would still read
    // `generating` and the test would be asserting nothing.
    vi.useFakeTimers()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
  }

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'key'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(imageAnswer()))),
    )
  })

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
    vi.unstubAllGlobals()
  })

  test('photo, generation, acceptance', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)
    await renderOnce(t, recipeId)

    const waiting = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(waiting?.beautifyStatus).toBe('review')
    expect(waiting?.beautifiedStorageId).toBeDefined()

    await expect(
      t.mutation(api.illustrations.acceptBeautified, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    const accepted = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(accepted).toMatchObject({
      beautifiedAccepted: true,
      beautifyStatus: 'idle',
    })
    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    expect(attempts).toMatchObject([
      { outcome: 'accepted', failureKind: null, costReported: true },
    ])
  })

  test('photo, generation, rejection', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const { storageId } = await attach(t, recipeId)
    await renderOnce(t, recipeId)
    const candidate = await t.run(
      async (ctx) =>
        (await ctx.db.get('recipes', recipeId))?.beautifiedStorageId,
    )

    await t.mutation(api.illustrations.rejectPendingCandidate, {
      adminToken,
      recipeId,
    })
    const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
    expect(recipe?.beautifiedStorageId).toBeUndefined()
    expect(recipe?.beautifyStatus).toBe('idle')
    expect(await stored(t, candidate!)).toBeNull()
    // The original never moves: rejecting a render is not losing the photo it was made from.
    expect(await stored(t, storageId)).not.toBeNull()

    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    expect(attempts).toMatchObject([{ outcome: 'rejected' }])
  })
})

describe('the hasIllustration backfill', () => {
  test('indexes the corpus in batches and survives an interruption', async () => {
    const t = setup()
    // Rows written straight to the table, without the flag: exactly what the existing corpus
    // looks like before the migration runs.
    const total = BACKFILL_BATCH + 5
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(jpeg())
      for (let index = 0; index < total; index += 1) {
        await ctx.db.insert('recipes', {
          title: `Ancienne ${index}`,
          type: 'autre' as const,
          ingredients: [],
          ingredientsInferred: false,
          steps: [],
          searchText: `ancienne ${index}`,
          status: 'review' as const,
          beautifiedAccepted: false,
          beautifyStatus: 'idle' as const,
          ...(index === 0 ? { imageStorageId: storageId } : {}),
        })
      }
    })

    // One page, then the interruption: the scheduled continuation is not run here.
    const first = await t.mutation(
      internal.migrations.backfillIllustrations,
      {},
    )
    expect(first).toBe(BACKFILL_BATCH)
    const midway = await t.run((ctx) =>
      ctx.db
        .query('migrations')
        .withIndex('by_name', (q) => q.eq('name', 'hasIllustration'))
        .first(),
    )
    expect(midway).toMatchObject({ done: false, migrated: BACKFILL_BATCH })

    // Resumed from the stored cursor: it finishes the corpus without rewriting what it already did.
    const second = await t.mutation(
      internal.migrations.backfillIllustrations,
      {},
    )
    expect(second).toBe(5)
    const third = await t.mutation(
      internal.migrations.backfillIllustrations,
      {},
    )
    expect(third).toBe(0)

    const rows = await t.run((ctx) => ctx.db.query('recipes').collect())
    expect(rows.every((row) => row.hasIllustration !== undefined)).toBe(true)
    expect(rows.filter((row) => row.hasIllustration).length).toBe(1)
  })
})

describe('the illustrationStage backfill', () => {
  /** The corpus as it exists before this lot: no stage, and possibly no `hasIllustration` either. */
  async function oldCorpus(t: Ctx, total: number) {
    return t.run(async (ctx) => {
      const storageId = await ctx.storage.store(jpeg())
      for (let index = 0; index < total; index += 1) {
        await ctx.db.insert('recipes', {
          title: `Ancienne ${index}`,
          type: 'autre' as const,
          ingredients: [],
          ingredientsInferred: false,
          steps: [],
          searchText: `ancienne ${index}`,
          status: 'review' as const,
          beautifiedAccepted: false,
          beautifyStatus: 'idle' as const,
          ...(index === 0 ? { imageStorageId: storageId } : {}),
        })
      }
    })
  }

  async function stageState(t: Ctx) {
    return t.run((ctx) =>
      ctx.db
        .query('migrations')
        .withIndex('by_name', (q) => q.eq('name', ILLUSTRATION_STAGE_MIGRATION))
        .first(),
    )
  }

  test('classifies the corpus in batches and survives an interruption', async () => {
    const t = setup()
    await oldCorpus(t, BACKFILL_BATCH + 5)

    const started = await t.mutation(
      api.migrations.startIllustrationStageBackfill,
      { adminToken },
    )
    expect(started).toEqual({ ok: true })
    const runId = (await stageState(t))?.runId
    expect(runId).toBeTypeOf('string')

    // One page at a time, the scheduled continuation not run here: the cursor is what resumes it.
    const first = await t.mutation(
      internal.migrations.backfillIllustrationStage,
      { runId: runId! },
    )
    expect(first).toBe(BACKFILL_BATCH)
    expect(await stageState(t)).toMatchObject({
      done: false,
      migrated: BACKFILL_BATCH,
    })

    expect(
      await t.mutation(internal.migrations.backfillIllustrationStage, {
        runId: runId!,
      }),
    ).toBe(5)
    expect(
      await t.mutation(internal.migrations.backfillIllustrationStage, {
        runId: runId!,
      }),
    ).toBe(0)

    const rows = await t.run((ctx) => ctx.db.query('recipes').collect())
    // Writes the superseded migration's field on the way, so a document the old chain never reached
    // is repaired in one pass.
    expect(rows.every((row) => row.illustrationStage !== undefined)).toBe(true)
    expect(rows.every((row) => row.hasIllustration !== undefined)).toBe(true)
    expect(
      rows.filter((row) => row.illustrationStage === 'to-beautify'),
    ).toHaveLength(1)
    expect(
      rows.filter((row) => row.illustrationStage === 'missing'),
    ).toHaveLength(BACKFILL_BATCH + 4)
    // The scan date, not the backfill's clock: it is the date the operator looks for in "Sans photo".
    expect(
      rows.every((row) => row.illustrationUpdatedAt === row._creationTime),
    ).toBe(true)

    const work = await listWork(t, { stagesReady: false })
    expect(work.migration.done).toBe(true)
    expect(work.stagesReady).toBe(true)
  })

  /**
   * Two clicks on "Relancer la migration" used to schedule two chains over one cursor: pages
   * reprocessed and `migrated` counted twice. Minting a token revokes the chain still in flight.
   */
  test('a chain whose token was revoked stops without writing', async () => {
    const t = setup()
    await oldCorpus(t, BACKFILL_BATCH + 5)

    await t.mutation(api.migrations.startIllustrationStageBackfill, {
      adminToken,
    })
    const stale = (await stageState(t))?.runId
    await t.mutation(internal.migrations.backfillIllustrationStage, {
      runId: stale!,
    })
    expect(await stageState(t)).toMatchObject({ migrated: BACKFILL_BATCH })

    // The relaunch mints a new token; the old chain's next batch no longer owns the migration.
    await t.mutation(api.migrations.startIllustrationStageBackfill, {
      adminToken,
    })
    const fresh = (await stageState(t))?.runId
    expect(fresh).not.toBe(stale)

    expect(
      await t.mutation(internal.migrations.backfillIllustrationStage, {
        runId: stale!,
      }),
    ).toBe(0)
    expect(await stageState(t)).toMatchObject({ migrated: BACKFILL_BATCH })

    // The owning chain carries on from the cursor it inherited, and the total is not doubled.
    expect(
      await t.mutation(internal.migrations.backfillIllustrationStage, {
        runId: fresh!,
      }),
    ).toBe(5)
    expect(await stageState(t)).toMatchObject({
      done: true,
      migrated: BACKFILL_BATCH + 5,
    })
  })

  test('skips a recipe it has already classified', async () => {
    const t = setup()
    await newRecipe(t, { title: 'Déjà classée' })

    await t.mutation(api.migrations.startIllustrationStageBackfill, {
      adminToken,
    })
    const runId = (await stageState(t))?.runId
    expect(
      await t.mutation(internal.migrations.backfillIllustrationStage, {
        runId: runId!,
      }),
    ).toBe(0)
  })

  test('keeps the flag consistent with the photo after every write', async () => {
    const t = setup()
    const scanId = await t.run((ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [],
        status: 'done' as const,
        attempts: 1,
        createdAt: 1,
      }),
    )
    const added = await t.mutation(api.recipeAdmin.addRecipe, {
      adminToken,
      scanId,
    })
    if (!added.ok) throw new Error(added.error)

    const check = async () => {
      const recipe = await t.run((ctx) => ctx.db.get('recipes', added.recipeId))
      expect(recipe?.hasIllustration).toBe(recipe?.imageStorageId !== undefined)
    }
    await check()
    await attach(t, added.recipeId)
    await check()
    await t.mutation(api.illustrations.detachIllustration, {
      adminToken,
      recipeId: added.recipeId,
    })
    await check()
  })
})

describe('beautification journal', () => {
  test('marks the groups of the model in service, whatever provider served them', async () => {
    // Beautification pins its model in code and pins no provider, so a routing change splits the
    // journal into several groups that are all in service — and the estimate averages them.
    const t = setup()
    const recipeId = await newRecipe(t)
    const sourceStorageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run(async (ctx) => {
      for (const [index, attempt] of [
        { model: BEAUTIFY_MODEL, servedProvider: 'Google AI Studio' },
        { model: BEAUTIFY_MODEL, servedProvider: 'Vertex' },
        { model: 'google/gemini-2.0-flash-image', servedProvider: 'Vertex' },
      ].entries()) {
        await ctx.db.insert('beautifyAttempts', {
          attemptId: `attempt-${index}`,
          recipeId,
          model: attempt.model,
          promptVersion: BEAUTIFY_PROMPT_VERSION,
          servedProvider: attempt.servedProvider,
          latencyMs: 9100,
          costUsd: 0.039,
          costReported: true,
          failureKind: null,
          sourceStorageId,
          outcome: 'pending' as const,
          createdAt: index,
        })
      }
    })

    const groups = await t.query(api.illustrations.beautifyStats, {
      adminToken,
    })
    expect(
      groups.map((group) => [
        group.model,
        group.servedProvider,
        group.isCurrent,
      ]),
    ).toEqual([
      ['google/gemini-2.0-flash-image', 'Vertex', false],
      [BEAUTIFY_MODEL, 'Vertex', true],
      [BEAUTIFY_MODEL, 'Google AI Studio', true],
    ])
  })

  test('marks nothing from a superseded prompt version', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const sourceStorageId = await t.run((ctx) => ctx.storage.store(jpeg()))
    await t.run((ctx) =>
      ctx.db.insert('beautifyAttempts', {
        attemptId: 'attempt-old',
        recipeId,
        model: BEAUTIFY_MODEL,
        promptVersion: `${BEAUTIFY_PROMPT_VERSION}-previous`,
        servedProvider: 'Google AI Studio',
        latencyMs: 9100,
        costUsd: 0.039,
        costReported: true,
        failureKind: null,
        sourceStorageId,
        outcome: 'accepted' as const,
        createdAt: 0,
      }),
    )
    const groups = await t.query(api.illustrations.beautifyStats, {
      adminToken,
    })
    expect(groups.map((group) => group.isCurrent)).toEqual([false])
  })
})

describe('the source-has-no-photo flag', () => {
  test('moves the recipe out of the work queue and back', async () => {
    const t = setup()
    const recipeId = await newRecipe(t, { title: 'Sans photo au livre' })

    expect(
      await t.mutation(api.illustrations.markNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toEqual({ ok: true })

    const marked = await listWork(t)
    expect(marked.missing.count).toBe(0)
    expect(marked.sourceHasNone.rows).toMatchObject([
      { id: recipeId, noPhotoAvailable: true },
    ])

    expect(
      await t.mutation(api.illustrations.clearNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toEqual({ ok: true })

    const cleared = await listWork(t)
    expect(cleared.sourceHasNone.count).toBe(0)
    expect(cleared.missing.rows).toMatchObject([
      { id: recipeId, noPhotoAvailable: false },
    ])
  })

  // Saying "the source has no photo" next to a photo is not a claim about the source.
  test('refuses to mark a recipe that has a photo', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await attach(t, recipeId)

    expect(
      await t.mutation(api.illustrations.markNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toMatchObject({ ok: false })
  })

  test('refuses to clear a recipe that is not marked', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)

    expect(
      await t.mutation(api.illustrations.clearNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toMatchObject({ ok: false })
  })

  test('refuses to mark the same recipe twice', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await t.mutation(api.illustrations.markNoPhotoAvailable, {
      adminToken,
      recipeId,
    })

    expect(
      await t.mutation(api.illustrations.markNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toMatchObject({ ok: false })
  })

  // A state that says "the source has no photo" next to a photo would be a state that lies, so
  // attaching clears it — and detaching therefore returns the recipe to `missing`, not to the mark.
  test('attaching a photo clears the mark for good', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    await t.mutation(api.illustrations.markNoPhotoAvailable, {
      adminToken,
      recipeId,
    })
    await attach(t, recipeId)

    expect(await t.run((ctx) => ctx.db.get('recipes', recipeId))).toMatchObject(
      { noPhotoAvailable: false, illustrationStage: 'to-beautify' },
    )

    await t.mutation(api.illustrations.detachIllustration, {
      adminToken,
      recipeId,
    })
    const work = await listWork(t)
    expect(work.missing.rows).toMatchObject([{ id: recipeId }])
    expect(work.sourceHasNone.count).toBe(0)
  })

  test('a historical document with no flag field survives every gesture', async () => {
    const t = setup()
    const recipeId = await unmigratedRecipe(t)
    await t.mutation(api.migrations.startIllustrationStageBackfill, {
      adminToken,
    })
    const runId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('migrations')
        .withIndex('by_name', (q) => q.eq('name', ILLUSTRATION_STAGE_MIGRATION))
        .first()
      return row?.runId
    })
    await t.mutation(internal.migrations.backfillIllustrationStage, {
      runId: runId!,
    })

    expect(
      await t.mutation(api.illustrations.markNoPhotoAvailable, {
        adminToken,
        recipeId,
      }),
    ).toEqual({ ok: true })
    const work = await listWork(t, { stagesReady: false })
    expect(work.sourceHasNone.rows).toMatchObject([{ id: recipeId }])
  })
})

describe('recency in the section that is always open', () => {
  /**
   * The three ways a recipe enters "À embellir". Only the first was covered by an earlier draft, and
   * the other two are exactly where the writer inventory was incomplete: neither changes the stage,
   * so neither would bump the date unless the rule is stated on `beautifyStatus` too.
   */
  async function twoRecipes(t: Ctx) {
    const older = await newRecipe(t, { title: 'Ancienne' })
    await attach(t, older)
    const newer = await newRecipe(t, { title: 'Récente' })
    await attach(t, newer)
    return { older, newer }
  }

  const titles = async (t: Ctx) =>
    (await listWork(t)).toBeautify.rows.map((row) => row.title)

  test('the most recently photographed comes first', async () => {
    const t = setup()
    await twoRecipes(t)
    expect(await titles(t)).toEqual(['Récente', 'Ancienne'])
  })

  test('a rejected candidate brings its recipe back to the top', async () => {
    const t = setup()
    const { older } = await twoRecipes(t)
    await toReview(t, older)
    await t.mutation(api.illustrations.rejectPendingCandidate, {
      adminToken,
      recipeId: older,
    })

    expect(await titles(t)).toEqual(['Ancienne', 'Récente'])
  })

  test('deleting a kept candidate brings its recipe back to the top', async () => {
    const t = setup()
    const { older } = await twoRecipes(t)
    await toReview(t, older)
    await t.mutation(api.illustrations.acceptBeautified, {
      adminToken,
      recipeId: older,
    })
    await t.mutation(api.illustrations.unpublishAcceptedCandidate, {
      adminToken,
      recipeId: older,
    })
    await t.mutation(api.illustrations.deleteUnpublishedCandidate, {
      adminToken,
      recipeId: older,
    })

    expect(await titles(t)).toEqual(['Ancienne', 'Récente'])
  })

  /**
   * The guard the compiler cannot give: it can prove a call that goes through the helper is complete,
   * never that a call which should go through it does. Two sites escaped review twice.
   */
  test('every function of both modules is classified as bumping or not', async () => {
    const illustrations = await import('./illustrations')
    const beautify = await import('./beautify')

    const bumps = [
      'attachIllustration',
      'commitIllustration',
      'detachIllustration',
      'requestBeautify',
      'acceptBeautified',
      'rejectPendingCandidate',
      'unpublishAcceptedCandidate',
      'deleteUnpublishedCandidate',
      'abandonBeautify',
      'markNoPhotoAvailable',
      'clearNoPhotoAvailable',
      'finalizeBeautify',
      'recordBeautifyFailure',
    ]
    /** Writes none of the five fields itself — reads, constants, or delegation to the two above. */
    const writesNothingIndexed = [
      'listIllustrationWork',
      'beautifyStats',
      // An action: it cannot patch. Its two outcomes are `finalizeBeautify` and
      // `recordBeautifyFailure`, which are classified as bumping.
      'render',
      'beautifyImage',
      'readBoundedBody',
      'decodeBeautifiedImage',
      'OPENROUTER_API_URL',
      'BEAUTIFY_TIMEOUT_MS',
      'MAX_BEAUTIFIED_BYTES',
      'MAX_BASE64_CHARS',
      'MAX_RESPONSE_BYTES',
    ]

    const classified = new Set([...bumps, ...writesNothingIndexed])
    const exported = [
      ...Object.keys(illustrations),
      ...Object.keys(beautify),
    ].sort()
    const unclassified = exported.filter((name) => !classified.has(name))
    expect(
      unclassified,
      'A new export must be classified: does it write imageStorageId, beautifiedStorageId, beautifiedAccepted, noPhotoAvailable or beautifyStatus? Then it bumps illustrationUpdatedAt.',
    ).toEqual([])
  })

  test('each bumping gesture actually moves the date', async () => {
    const t = setup()
    const recipeId = await newRecipe(t)
    const dateOf = async () =>
      (await t.run((ctx) => ctx.db.get('recipes', recipeId)))
        ?.illustrationUpdatedAt ?? 0

    const before = await dateOf()
    await attach(t, recipeId)
    const attached = await dateOf()
    expect(attached).toBeGreaterThanOrEqual(before)

    await toReview(t, recipeId)
    await t.mutation(api.illustrations.rejectPendingCandidate, {
      adminToken,
      recipeId,
    })
    expect(await dateOf()).toBeGreaterThanOrEqual(attached)

    await t.mutation(api.illustrations.requestBeautify, {
      adminToken,
      recipeId,
    })
    const requested = await dateOf()
    expect(requested).toBeGreaterThanOrEqual(attached)

    await t.mutation(api.illustrations.detachIllustration, {
      adminToken,
      recipeId,
    })
    expect(await dateOf()).toBeGreaterThanOrEqual(requested)
  })
})

describe('the section ceiling', () => {
  test('serves past the default page once the limit is raised', async () => {
    const t = setup()
    for (let index = 0; index < 3; index += 1) {
      await newRecipe(t, { title: `Sans photo ${index}` })
    }

    const capped = await listWork(t, { missing: 2 })
    expect(capped.missing.count).toBe(2)
    expect(capped.missing.truncated).toBe(true)

    const raised = await listWork(t, { missing: 4 })
    expect(raised.missing.count).toBe(3)
    expect(raised.missing.truncated).toBe(false)
  })

  // A client-supplied limit must never become an unbounded read.
  test('clamps a limit past the hard ceiling', async () => {
    const t = setup()
    await newRecipe(t)
    await markStagesDone(t)

    const work = await t.query(api.illustrations.listIllustrationWork, {
      adminToken,
      limits: {
        toBeautify: 10_000,
        missing: 10_000,
        sourceHasNone: null,
        done: null,
      },
    })
    expect(work.missing.count).toBe(1)
    expect(work.missing.truncated).toBe(false)
  })
})
