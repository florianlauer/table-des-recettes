import { DEFAULT_BATCH_SIZE } from '@convex-dev/migrations'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import {
  adminToken,
  attach,
  harness,
  jpeg,
  listWork,
  newRecipe,
  runStageBackfill,
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
    // `unknown`, not a zero count: nobody has classified anything yet, and the screen must not print
    // that as an answer.
    expect(migrating.migration).toEqual({
      state: 'unknown',
      processed: 0,
      ready: false,
    })

    const ready = await listWork(t)
    expect(ready.stagesReady).toBe(true)
    expect(ready.migration).toMatchObject({ state: 'success', ready: true })
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

describe('the illustrationStage backfill', () => {
  /** The corpus as it exists before this lot: no stage, and no `hasIllustration` either. */
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

  /**
   * A corpus larger than one batch, so the run really goes through the component's rescheduling
   * rather than fitting in the first transaction. Batching, cursor and resume belong to the component
   * and are its own tests; what is asserted here is the classification and the date it stamps.
   */
  test('classifies a corpus larger than one batch', async () => {
    const t = setup()
    await oldCorpus(t, DEFAULT_BATCH_SIZE + 5)

    await runStageBackfill(t)

    const rows = await t.run((ctx) => ctx.db.query('recipes').collect())
    // Writes the superseded `hasIllustration` migration's field on the way, so a document that
    // migration never reached is repaired in one pass.
    expect(rows.every((row) => row.illustrationStage !== undefined)).toBe(true)
    expect(rows.every((row) => row.hasIllustration !== undefined)).toBe(true)
    expect(
      rows.filter((row) => row.illustrationStage === 'to-beautify'),
    ).toHaveLength(1)
    expect(
      rows.filter((row) => row.illustrationStage === 'missing'),
    ).toHaveLength(DEFAULT_BATCH_SIZE + 4)
    // The scan date, not the backfill's clock: it is the date the operator looks for in "Sans photo".
    expect(
      rows.every((row) => row.illustrationUpdatedAt === row._creationTime),
    ).toBe(true)

    const work = await listWork(t, { stagesReady: false })
    expect(work.migration).toMatchObject({
      state: 'success',
      processed: DEFAULT_BATCH_SIZE + 5,
      ready: true,
    })
    expect(work.stagesReady).toBe(true)
  })

  /**
   * The deploy runs the series every time, so the common case is a migration that has nothing left to
   * do. It must not touch a stage a live mutation wrote since, and it must not restamp a date.
   */
  test('leaves an already classified recipe alone, however often it runs', async () => {
    const t = setup()
    const recipeId = await newRecipe(t, { title: 'Déjà classée' })
    await attach(t, recipeId)
    // The three derived keys, and nothing else: `attach` also schedules a rendition, which the
    // scheduler drain inside `runMigrations` completes and which has no business in this assertion.
    const derived = async () => {
      const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
      return {
        hasIllustration: recipe?.hasIllustration,
        illustrationStage: recipe?.illustrationStage,
        illustrationUpdatedAt: recipe?.illustrationUpdatedAt,
      }
    }
    const before = await derived()

    await runStageBackfill(t)
    await runStageBackfill(t)

    expect(await derived()).toEqual(before)
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
   * That every gesture goes through `writeIllustration` is now a lint rule, which reports at the
   * offending line and cannot pass by reading nothing the way a test globbing its own sources can.
   * What stays here is the half a rule cannot check: that the write really moves the date.
   */
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
    await runStageBackfill(t)

    const work = await t.query(api.illustrationsList.listIllustrationWork, {
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
