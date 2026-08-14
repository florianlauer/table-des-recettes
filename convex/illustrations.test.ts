import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { bytesToBase64 } from '../src/lib/base64'
import {
  BEAUTIFY_MODEL,
  BEAUTIFY_PROMPT_VERSION,
} from '../src/lib/beautifyPrompt'
import {
  adminToken,
  attach,
  harness,
  jpeg,
  jpegBytes,
  listWork,
  newRecipe,
  runStageBackfill,
  stored,
  ticket,
  toReview,
  unmigratedRecipe,
} from '../test/illustrationFixtures'
import type { Ctx } from '../test/illustrationFixtures'

const modules = import.meta.glob('./**/*.ts')
const setup = () => harness(modules)

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
    expect(await stored(t, candidate)).toBeNull()
    // The original never moves: rejecting a render is not losing the photo it was made from.
    expect(await stored(t, storageId)).not.toBeNull()

    const attempts = await t.run((ctx) =>
      ctx.db.query('beautifyAttempts').collect(),
    )
    expect(attempts).toMatchObject([{ outcome: 'rejected' }])
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
    await runStageBackfill(t)

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
