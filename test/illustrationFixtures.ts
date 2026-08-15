import { convexTest } from 'convex-test'
import { api, internal } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { withIllustration } from '../convex/lib/recipeWrites'
import schema from '../convex/schema'
import { BEAUTIFY_PROMPT_VERSION } from '../src/shared/beautifyPrompt'
import { registerComponents } from './convexComponents'

/**
 * The fixtures the photo work screen's two test files share — the gestures in
 * `convex/illustrations.test.ts`, the reading in `convex/illustrationsList.test.ts`.
 *
 * `modules` is passed in rather than globbed here: `import.meta.glob` resolves relative to the file it
 * appears in, and `convex-test` keys its function paths off those very strings. It has to be evaluated
 * inside `convex/`.
 */
export const adminToken = 'test-secret'

export type Ctx = ReturnType<typeof convexTest>

export function harness(modules: Record<string, () => Promise<unknown>>): Ctx {
  const t = convexTest(schema, modules)
  registerComponents(t)
  return t
}

export function jpegBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16])
  return bytes
}

export function jpeg(): Blob {
  return new Blob([jpegBytes()], { type: 'image/jpeg' })
}

export async function newRecipe(t: Ctx, over: Record<string, unknown> = {}) {
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
export async function unmigratedRecipe(
  t: Ctx,
  over: Record<string, unknown> = {},
) {
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

/**
 * The stage sections are not read until the backfill is done, so a test that reads them says so — by
 * running the real migration rather than by hand-writing a "done" row.
 *
 * The stage backfill alone, not the whole `runAll` series: the rendition backfill in that series would
 * re-enqueue a derivation over a fixture that deliberately holds a `failed` rendition. Over a corpus
 * already carrying its stages that is a pass with zero patches, and it is the same code path
 * production runs.
 */
export async function runStageBackfill(t: Ctx) {
  await t.mutation(internal.migrations.backfillIllustrationStage, {})
  await t.finishAllScheduledFunctions(() => {})
}

export const ALL_OPEN = {
  toBeautify: 50,
  missing: 50,
  sourceHasNone: 50,
  done: 50,
} as const

export type OpenLimits = {
  toBeautify?: number
  missing?: number | null
  sourceHasNone?: number | null
  done?: number | null
}

export async function listWork(
  t: Ctx,
  limits: OpenLimits & { stagesReady?: boolean } = {},
) {
  const { stagesReady = true, ...open } = limits
  if (stagesReady) await runStageBackfill(t)
  return t.query(api.illustrations.listIllustrationWork, {
    adminToken,
    limits: { ...ALL_OPEN, ...open },
  })
}

export async function ticket(
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

export async function stored(t: Ctx, storageId: Id<'_storage'>) {
  return t.run((ctx) => ctx.db.system.get('_storage', storageId))
}

/** Posts a photo the way the screen does: a ticket, an upload, then the action. */
export async function attach(t: Ctx, recipeId: Id<'recipes'>) {
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

/** Brings a recipe to `review` with a journalled attempt, the way a render does. */
export async function toReview(t: Ctx, recipeId: Id<'recipes'>) {
  const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
  if (!recipe?.imageStorageId) throw new Error('Fixture sans photo')
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
      sourceStorageId: recipe.imageStorageId,
      outcome: 'pending',
      createdAt: Date.now(),
    })
  })
  return { attemptId, candidate }
}
