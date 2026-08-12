import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { beautifyOutcome } from '../schema'
import { literalUnion } from './validators'
import { BEAUTIFY_PROMPT_VERSION } from '../../src/lib/beautifyPrompt'
import { BEAUTIFY_FAILURE_KINDS } from '../../src/lib/beautifyFailureKinds'

/** What the action measured about a call, and nothing about what was decided of it. */
export const beautifyObservation = {
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.union(v.string(), v.null()),
  latencyMs: v.number(),
  costUsd: v.number(),
  costReported: v.boolean(),
}

export type BeautifyObservation = Infer<
  ReturnType<typeof v.object<typeof beautifyObservation>>
>

export const beautifyFailureKind = literalUnion(BEAUTIFY_FAILURE_KINDS)

export async function findAttempt(
  ctx: QueryCtx,
  attemptId: string,
): Promise<Doc<'beautifyAttempts'> | null> {
  return ctx.db
    .query('beautifyAttempts')
    .withIndex('by_attempt_id', (q) => q.eq('attemptId', attemptId))
    .first()
}

/**
 * Single writer of the beautification journal, and idempotent by construction: Convex has no unique
 * constraint, so the row is looked up inside the same transaction that would insert it. Without
 * this, a replayed finalisation writes the same billed call twice and the aggregate reports double
 * the money actually spent.
 *
 * Returns `false` when the attempt was already journalled — which the callers read as "this exact
 * call has already been settled", and therefore as a reason to destroy nothing.
 */
export async function journalBeautifyAttempt(
  ctx: MutationCtx,
  {
    recipeId,
    sourceStorageId,
    outcome,
    failureKind,
    ...observation
  }: BeautifyObservation & {
    recipeId: Id<'recipes'>
    sourceStorageId: Id<'_storage'>
    outcome: Infer<typeof beautifyOutcome>
    failureKind: Infer<typeof beautifyFailureKind> | null
  },
): Promise<boolean> {
  if (await findAttempt(ctx, observation.attemptId)) return false
  await ctx.db.insert('beautifyAttempts', {
    ...observation,
    recipeId,
    sourceStorageId,
    outcome,
    failureKind,
    // Stamped here rather than passed in: the caller is the deployment that made the call, so any
    // other value would misattribute the row to a prompt that did not produce it.
    promptVersion: BEAUTIFY_PROMPT_VERSION,
    createdAt: Date.now(),
  })
  return true
}

/**
 * Rewrites the outcome once, and only from `pending` — which is what forbids a second arbitration.
 * `discarded` is not a verdict: it is what a candidate destroyed outside any arbitration becomes,
 * so its billed cost keeps being counted without claiming a judgement nobody made.
 */
export async function settleAttempt(
  ctx: MutationCtx,
  attemptId: string | undefined,
  outcome: 'accepted' | 'rejected' | 'discarded',
): Promise<void> {
  if (!attemptId) return
  const attempt = await findAttempt(ctx, attemptId)
  if (attempt && attempt.outcome === 'pending')
    await ctx.db.patch(attempt._id, { outcome })
}
