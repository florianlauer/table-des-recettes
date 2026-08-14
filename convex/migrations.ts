import { Migrations } from '@convex-dev/migrations'
import type {
  MigrationFunctionReference,
  MigrationStatus,
} from '@convex-dev/migrations'
import { v } from 'convex/values'
import { components, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { pendingSlotsOf, renditionPool } from './derivations'
import { withIllustration } from './lib/recipeWrites'
import { publishedRecipes } from './recipeCounts'
import { ceilingFor } from './retention'
import schema from './schema'

/**
 * Batching, cursor, resume, refusal to run twice: all of it belongs to `@convex-dev/migrations`
 * rather than to this file. What was hand-rolled here — a `migrations` table, a `runId` lease against
 * two chains over one cursor, a "Relancer la migration" button — was a worse copy of a component the
 * platform maintains, and its trigger was a human remembering to press something.
 *
 * Every backfill of this project lives in this file, whatever table it walks: that is what makes
 * `runAll` a readable list of what a deploy actually does. The domain rule stays in its own module and
 * is imported — `ceilingFor` below comes from `retention.ts`.
 *
 * `internalMutation` types `migrateOne` against this project's tables; `schema` is what `customRange`
 * needs to type an index range.
 */
export const migrations = new Migrations(components.migrations, {
  internalMutation,
  schema,
})

/**
 * Fills `illustrationStage`, `illustrationUpdatedAt` and `hasIllustration` — the three derived keys
 * the photo work screen reads its sections from. Rows that already carry a stage are skipped, which
 * is what makes a resumed run cheap and what stops the backfill from stomping on a value a live
 * mutation wrote in the meantime.
 *
 * `at` is `_creationTime`, not `Date.now()`: a recipe that was never photographed must keep its scan
 * date, because that is the date the operator is looking for in "Sans photo". Stamping the whole
 * corpus with the migration's own clock would flatten every batch into one.
 */
export const backfillIllustrationStage = migrations.define({
  table: 'recipes',
  migrateOne: (_ctx, recipe) => {
    if (recipe.illustrationStage !== undefined) return
    return withIllustration(
      {
        imageStorageId: recipe.imageStorageId,
        beautifiedAccepted: recipe.beautifiedAccepted,
        noPhotoAvailable: recipe.noPhotoAvailable ?? false,
      },
      recipe._creationTime,
    )
  },
})

/**
 * Gives every scan a purge deadline. `customRange` is what keeps this cheap: the range is the scans
 * that have none, so a resumed run does not walk the ones already done — and it is also why the
 * constructor above is given `schema`.
 *
 * The deadline is deliberately not `now`-relative alone. `ceilingFor` floors it at `PURGE_GRACE_MS`
 * from today, so a corpus of historical scans does not become purgeable the instant this runs.
 */
export const backfillPurgeAfter = migrations.define({
  table: 'scans',
  customRange: (query) =>
    query.withIndex('by_purge_after', (q) => q.eq('purgeAfter', undefined)),
  migrateOne: (_ctx, scan) => ({
    purgeAfter: ceilingFor({ createdAt: scan.createdAt, now: Date.now() }),
  }),
})

/**
 * Enqueues the display derivative of every slot that carries a blob and has none — the pass that
 * takes a photo off the storefront's full-weight fallback.
 *
 * The bound is the point: this walks the whole corpus, and `scheduler.runAfter(0, …)` per slot would
 * start every decode at once. `renditionPool` runs `RENDITION_PARALLELISM` of them at a time.
 *
 * `customRange` on `by_illustration` skips the recipes that have no photo at all, which is most of
 * them. It reads `hasIllustration`, so it depends on `backfillIllustrationStage` having run — hence
 * the order of the series below, which the component executes serially.
 */
const enqueuePendingRenditions =
  (retryFailed: boolean) =>
  async (ctx: MutationCtx, recipe: Doc<'recipes'>): Promise<void> => {
    for (const pending of pendingSlotsOf(recipe, retryFailed)) {
      await renditionPool.enqueueAction(ctx, internal.derive.deriveRendition, {
        recipeId: recipe._id,
        ...pending,
      })
    }
  }

export const backfillRenditions = migrations.define({
  table: 'recipes',
  customRange: (query) =>
    query.withIndex('by_illustration', (q) => q.eq('hasIllustration', true)),
  migrateOne: enqueuePendingRenditions(false),
})

/**
 * The same pass, including the slots that have spent their attempt budget. Deliberately **not** in the
 * series: a source sharp cannot decode is retried three times and then left alone, and re-enqueueing
 * it on every deploy would spend the budget again for ever.
 *
 * Run by hand when a failure is known to have been infrastructural rather than about the bytes:
 * `npx convex run migrations:retryFailedRenditions '{"reset": true}'` — `reset` because it will
 * already be marked done from its last use.
 */
export const retryFailedRenditions = migrations.define({
  table: 'recipes',
  customRange: (query) =>
    query.withIndex('by_illustration', (q) => q.eq('hasIllustration', true)),
  migrateOne: enqueuePendingRenditions(true),
})

/**
 * Puts the existing corpus into the counts aggregate. `insertIfDoesNotExist` rather than `insert`, so
 * a resumed run — or a recipe the live write path already counted — is a no-op rather than a throw.
 *
 * Until this finishes, `countsByType` falls back to reading the table: an aggregate that holds half
 * the corpus would put a wrong number on a public page, which is worse than a slow one.
 */
export const backfillRecipeCounts = migrations.define({
  table: 'recipes',
  migrateOne: async (ctx, recipe) => {
    await publishedRecipes.insertIfDoesNotExist(ctx, recipe)
  },
})

/**
 * The single entry point, run at the end of every production deploy (`vercel.json`) and after a
 * preview's data import (`.github/workflows/preview.yml`). A series rather than one function so the
 * next migration is one line here and nothing else has to change.
 *
 * Safe to call on every deploy: a finished migration is skipped, an in-flight one no-ops, and an
 * interrupted one resumes from its own cursor. Order matters — `backfillRenditions` reads the
 * `hasIllustration` key that `backfillIllustrationStage` writes.
 */
export const runAll = migrations.runner([
  internal.migrations.backfillIllustrationStage,
  internal.migrations.backfillPurgeAfter,
  internal.migrations.backfillRenditions,
  internal.migrations.backfillRecipeCounts,
])

/**
 * A migration's own status, read from a query. That is what makes a backfill's completion something the
 * read path can branch on: the query takes a dependency on the component's progress, so a screen or a
 * page flips to the fast read by itself the moment the last batch commits — no reload, no button.
 *
 * `.at(0)` rather than a destructured `[status]`: the component answers one entry per requested name —
 * a name it has never seen included — but the type does not say so, and a silent TypeError here would
 * take the caller down with it.
 */
async function statusOf(
  ctx: QueryCtx,
  migration: MigrationFunctionReference,
): Promise<MigrationStatus | undefined> {
  return (await migrations.getStatus(ctx, { migrations: [migration] })).at(0)
}

export const illustrationStageStatus = v.object({
  // `unknown` is the never-run case, and it is the one that must not read as zero on screen.
  state: v.union(
    v.literal('inProgress'),
    v.literal('success'),
    v.literal('failed'),
    v.literal('canceled'),
    v.literal('unknown'),
  ),
  processed: v.number(),
  ready: v.boolean(),
})

/**
 * What the photo work screen needs to decide whether the four stage sections can be read at all.
 *
 * `state` is what the hand-rolled version could not produce: it tells a stalled chain from a running
 * one without persisting an error the admin screen is not allowed to display (`adminError.ts`).
 */
export async function readIllustrationStageStatus(
  ctx: QueryCtx,
): Promise<typeof illustrationStageStatus.type> {
  const status = await statusOf(
    ctx,
    internal.migrations.backfillIllustrationStage,
  )
  return {
    state: status?.state ?? 'unknown',
    processed: status?.processed ?? 0,
    ready: status?.isDone ?? false,
  }
}

/**
 * Whether the counts aggregate holds the whole corpus. Read by `countsByType`, which falls back to the
 * table until it does — a public page must not show a count taken from half an index.
 */
export async function recipeCountsReady(ctx: QueryCtx): Promise<boolean> {
  return (
    (await statusOf(ctx, internal.migrations.backfillRecipeCounts))?.isDone ??
    false
  )
}
