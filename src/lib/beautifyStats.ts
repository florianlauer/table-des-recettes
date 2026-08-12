/**
 * What the beautification journal says about the model in use. Deliberately not `attemptSummary`:
 * that one keys on a `schemaVersion` no image has, and it has no notion of what a human decided of
 * the result — which is the whole question here. A model that never fails technically and gets
 * rejected nine times out of ten is failing.
 *
 * Only the *shape* is separate: the grouping, the failure tally and the averages come from
 * `journalStats`, shared with the extraction journal.
 */
import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import { costLooksExcessive } from './beautifyPrompt'
import {
  costAndLatency,
  countFailureKinds,
  groupByIdentity,
} from './journalStats'
import type { NonEmpty } from './journalStats'

export const BEAUTIFY_ATTEMPTS_SAMPLED = 200

export type BeautifyOutcome = 'pending' | 'accepted' | 'rejected' | 'discarded'

/** The subset of a journal row this reading needs — the rest is diagnosis, not trend. */
export type JournalledBeautifyAttempt = {
  model: string
  promptVersion: string
  outcome: BeautifyOutcome
  failureKind: string | null
  costUsd: number
  costReported: boolean
  latencyMs: number
}

export const beautifySummary = v.object({
  model: v.string(),
  promptVersion: v.string(),
  attempts: v.number(),
  pending: v.number(),
  accepted: v.number(),
  rejected: v.number(),
  discarded: v.number(),
  technicalFailures: v.number(),
  failureRate: v.number(),
  failureKinds: v.array(v.object({ kind: v.string(), count: v.number() })),
  totalCostUsd: v.number(),
  averageCostUsd: v.number(),
  averageLatencyMs: v.number(),
  // Without this the total reads as exact when it is only a floor: a response with no reported
  // price is journalled at zero, which is indistinguishable from a free call.
  unreportedCostCalls: v.number(),
  excessiveCostCalls: v.number(),
})

export type BeautifySummary = Infer<typeof beautifySummary>

export type BeautifyIdentity = Pick<
  JournalledBeautifyAttempt,
  'model' | 'promptVersion'
>

export function beautifyGroupKey({
  model,
  promptVersion,
}: BeautifyIdentity): string {
  return `${model} ${promptVersion}`
}

export function summarizeBeautifyAttempts(
  attempts: JournalledBeautifyAttempt[],
): BeautifySummary[] {
  return groupByIdentity(attempts, beautifyGroupKey).map(summarizeGroup)
}

function summarizeGroup(
  rows: NonEmpty<JournalledBeautifyAttempt>,
): BeautifySummary {
  const { model, promptVersion } = rows[0]
  const count = (keep: (row: JournalledBeautifyAttempt) => boolean) =>
    rows.filter(keep).length
  // A technical failure is a `failureKind`, not a `discarded`: a call whose finalisation merely
  // arrived too late succeeded, it just found nothing left to attach to.
  const technicalFailures = count((row) => row.failureKind !== null)

  return {
    model,
    promptVersion,
    attempts: rows.length,
    pending: count((row) => row.outcome === 'pending'),
    accepted: count((row) => row.outcome === 'accepted'),
    rejected: count((row) => row.outcome === 'rejected'),
    discarded: count((row) => row.outcome === 'discarded'),
    technicalFailures,
    failureRate: technicalFailures / rows.length,
    failureKinds: countFailureKinds(rows),
    ...costAndLatency(rows),
    unreportedCostCalls: count((row) => !row.costReported),
    excessiveCostCalls: count(
      (row) => row.costReported && costLooksExcessive(row.costUsd),
    ),
  }
}
