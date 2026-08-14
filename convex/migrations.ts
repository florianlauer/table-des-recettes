import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { withIllustration } from './lib/recipeWrites'
import { okOrError, refuse, succeeded } from './lib/validators'

/**
 * @deprecated Superseded by `ILLUSTRATION_STAGE_MIGRATION`, which writes `hasIllustration` too. Kept
 * — with its worker — for one lot: a continuation already scheduled references
 * `internal.migrations.backfillIllustrations`, and deleting it would leave that job unresolvable and
 * the old migration stranded mid-corpus.
 */
export const HAS_ILLUSTRATION_MIGRATION = 'hasIllustration'

export const ILLUSTRATION_STAGE_MIGRATION = 'illustrationStage'
// One page per transaction. The corpus is a few hundred recipes today, but a single mutation over
// the whole table is a transaction with no ceiling, and Convex refuses those past a certain size.
export const BACKFILL_BATCH = 200

export async function readMigration(
  ctx: QueryCtx,
  name: string,
): Promise<Doc<'migrations'> | null> {
  return ctx.db
    .query('migrations')
    .withIndex('by_name', (q) => q.eq('name', name))
    .first()
}

async function saveMigration(
  ctx: MutationCtx,
  {
    name,
    cursor,
    done,
    migrated,
    runId,
  }: {
    name: string
    cursor: string | null
    done: boolean
    migrated: number
    runId?: string
  },
): Promise<void> {
  const existing = await readMigration(ctx, name)
  const fields = { name, cursor, done, migrated, runId, updatedAt: Date.now() }
  if (existing) await ctx.db.patch(existing._id, fields)
  else await ctx.db.insert('migrations', fields)
}

/**
 * Fills `hasIllustration` one page at a time, rescheduling itself until the corpus is done and
 * writing its cursor as it goes. Interrupted — a deploy, a crash, a transaction refused — it picks
 * up where it stopped instead of starting over.
 *
 * Only rows that have no value are written. That is what makes a resumed run cheap, and it is also
 * what stops the backfill from stomping on a flag a live mutation set in the meantime.
 */
export const backfillIllustrations = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const state = await readMigration(ctx, HAS_ILLUSTRATION_MIGRATION)
    if (state?.done) return 0

    const page = await ctx.db.query('recipes').paginate({
      cursor: state?.cursor ?? null,
      numItems: BACKFILL_BATCH,
    })
    let migrated = 0
    for (const recipe of page.page) {
      if (recipe.hasIllustration !== undefined) continue
      await ctx.db.patch(recipe._id, {
        hasIllustration: recipe.imageStorageId !== undefined,
      })
      migrated += 1
    }

    await saveMigration(ctx, {
      name: HAS_ILLUSTRATION_MIGRATION,
      cursor: page.continueCursor,
      done: page.isDone,
      migrated: (state?.migrated ?? 0) + migrated,
    })
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillIllustrations,
        {},
      )
    return migrated
  },
})

/**
 * Fills `illustrationStage`, `illustrationUpdatedAt` and `hasIllustration` one page at a time,
 * rescheduling itself until the corpus is done. Supersedes `backfillIllustrations`: it writes that
 * migration's field too, so a document the old chain never reached is repaired in one pass.
 *
 * `at` is `_creationTime`, not `Date.now()`: a recipe that was never photographed must keep its scan
 * date, because that is the date the operator is looking for in "Sans photo".
 *
 * `runId` is the lease. Two clicks on "Relancer la migration" used to schedule two chains over one
 * cursor; a batch whose token has been revoked returns without writing, and the read and the write
 * share one transaction, so the check has no window.
 */
export const backfillIllustrationStage = internalMutation({
  args: { runId: v.string() },
  returns: v.number(),
  handler: async (ctx, { runId }) => {
    const state = await readMigration(ctx, ILLUSTRATION_STAGE_MIGRATION)
    if (state?.done) return 0
    if (state && state.runId !== runId) return 0

    const page = await ctx.db.query('recipes').paginate({
      cursor: state?.cursor ?? null,
      numItems: BACKFILL_BATCH,
    })
    let migrated = 0
    for (const recipe of page.page) {
      if (recipe.illustrationStage !== undefined) continue
      await ctx.db.patch(
        recipe._id,
        withIllustration(
          {
            imageStorageId: recipe.imageStorageId,
            beautifiedAccepted: recipe.beautifiedAccepted,
            noPhotoAvailable: recipe.noPhotoAvailable ?? false,
          },
          recipe._creationTime,
        ),
      )
      migrated += 1
    }

    await saveMigration(ctx, {
      name: ILLUSTRATION_STAGE_MIGRATION,
      cursor: page.continueCursor,
      done: page.isDone,
      migrated: (state?.migrated ?? 0) + migrated,
      runId,
    })
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillIllustrationStage,
        { runId },
      )
    return migrated
  },
})

export const startIllustrationStageBackfill = mutation({
  args: { adminToken: v.string(), restart: v.optional(v.boolean()) },
  returns: okOrError,
  handler: async (ctx, { adminToken, restart }) => {
    requireAdmin(adminToken)
    const state = await readMigration(ctx, ILLUSTRATION_STAGE_MIGRATION)
    if (state?.done && !restart) return refuse('Migration déjà terminée')

    // Minting the token here is what revokes any chain still in flight: the next batch of the old
    // run reads a name it does not own and stops.
    const runId = crypto.randomUUID()
    if (restart && state) await ctx.db.delete(state._id)
    await saveMigration(ctx, {
      name: ILLUSTRATION_STAGE_MIGRATION,
      cursor: restart ? null : (state?.cursor ?? null),
      done: false,
      migrated: restart ? 0 : (state?.migrated ?? 0),
      runId,
    })
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillIllustrationStage,
      { runId },
    )
    return succeeded
  },
})

/**
 * Manual relaunch, matching the project's refusal of automatic surveillance: a migration stuck
 * mid-corpus is visible on the work list, and restarting it is a decision, not a cron.
 *
 * @deprecated Drives the superseded `hasIllustration` migration. See the constant above.
 */
export const startIllustrationBackfill = mutation({
  args: { adminToken: v.string(), restart: v.optional(v.boolean()) },
  returns: okOrError,
  handler: async (ctx, { adminToken, restart }) => {
    requireAdmin(adminToken)
    const state = await readMigration(ctx, HAS_ILLUSTRATION_MIGRATION)
    if (state?.done && !restart) return refuse('Migration déjà terminée')
    if (restart && state) await ctx.db.delete(state._id)
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillIllustrations,
      {},
    )
    return succeeded
  },
})
