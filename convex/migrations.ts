import { Migrations } from '@convex-dev/migrations'
import { v } from 'convex/values'
import { components, internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import { withIllustration } from './lib/recipeWrites'

/**
 * Batching, cursor, resume, refusal to run twice: all of it belongs to `@convex-dev/migrations`
 * rather than to this file. What was hand-rolled here — a `migrations` table, a `runId` lease against
 * two chains over one cursor, a "Relancer la migration" button — was a worse copy of a component the
 * platform maintains, and its trigger was a human remembering to press something.
 *
 * `internalMutation` is passed so `migrateOne` is typed against this project's tables.
 */
export const migrations = new Migrations(components.migrations, {
  internalMutation,
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
 * The single entry point, run at the end of every production deploy (`vercel.json`) and after a
 * preview's data import (`.github/workflows/preview.yml`). A series rather than one function so the
 * next migration is one line here and nothing else has to change.
 *
 * Safe to call on every deploy: a finished migration is skipped, an in-flight one no-ops, and an
 * interrupted one resumes from its own cursor.
 */
export const runAll = migrations.runner([
  internal.migrations.backfillIllustrationStage,
])

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
 * Reading it adds a dependency on the component's own progress, so the sections appear by themselves
 * the moment the last batch commits — no reload, no button.
 *
 * `state` is what the hand-rolled version could not produce: it tells a stalled chain from a running
 * one without persisting an error the admin screen is not allowed to display (`adminError.ts`).
 */
export async function readIllustrationStageStatus(
  ctx: QueryCtx,
): Promise<typeof illustrationStageStatus.type> {
  // `.at(0)` rather than a destructured `[status]`: the component answers one entry per requested
  // name — a name it has never seen included — but the type does not say so, and a silent TypeError
  // here would take the whole screen down.
  const status = (
    await migrations.getStatus(ctx, {
      migrations: [internal.migrations.backfillIllustrationStage],
    })
  ).at(0)
  return {
    state: status?.state ?? 'unknown',
    processed: status?.processed ?? 0,
    ready: status?.isDone ?? false,
  }
}
