import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { okOrError, refuse, succeeded } from './lib/validators'

export const HAS_ILLUSTRATION_MIGRATION = 'hasIllustration'
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
  }: { name: string; cursor: string | null; done: boolean; migrated: number },
): Promise<void> {
  const existing = await readMigration(ctx, name)
  const fields = { name, cursor, done, migrated, updatedAt: Date.now() }
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
 * Manual relaunch, matching the project's refusal of automatic surveillance: a migration stuck
 * mid-corpus is visible on the work list, and restarting it is a decision, not a cron.
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
