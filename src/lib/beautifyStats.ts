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
  // Part of the identity, not of the diagnosis: beautification pins no provider, so a routing change
  // would otherwise average two different speeds into one meaningless figure.
  servedProvider: string | null
  outcome: BeautifyOutcome
  failureKind: string | null
  costUsd: number
  costReported: boolean
  latencyMs: number
}

const beautifySummaryFields = {
  model: v.string(),
  promptVersion: v.string(),
  servedProvider: v.union(v.string(), v.null()),
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
}

/** What the pure summariser produces — see the note on `attemptSummaryBase`. */
export const beautifySummaryBase = v.object(beautifySummaryFields)

/** What the query answers: the same, plus which groups describe the configuration in service. */
export const beautifySummary = v.object({
  ...beautifySummaryFields,
  isCurrent: v.boolean(),
})

export type BeautifySummary = Infer<typeof beautifySummaryBase>
export type WireBeautifySummary = Infer<typeof beautifySummary>

export type BeautifyIdentity = Pick<
  JournalledBeautifyAttempt,
  'model' | 'promptVersion' | 'servedProvider'
>

export function beautifyGroupKey({
  model,
  promptVersion,
  servedProvider,
}: BeautifyIdentity): string {
  return `${model} ${promptVersion} ${servedProvider ?? '—'}`
}

export function summarizeBeautifyAttempts(
  attempts: JournalledBeautifyAttempt[],
): BeautifySummary[] {
  return groupByIdentity(attempts, beautifyGroupKey).map(summarizeGroup)
}

function summarizeGroup(
  rows: NonEmpty<JournalledBeautifyAttempt>,
): BeautifySummary {
  const { model, promptVersion, servedProvider } = rows[0]
  const count = (keep: (row: JournalledBeautifyAttempt) => boolean) =>
    rows.filter(keep).length
  // A technical failure is a `failureKind`, not a `discarded`: a call whose finalisation merely
  // arrived too late succeeded, it just found nothing left to attach to.
  const technicalFailures = count((row) => row.failureKind !== null)

  return {
    model,
    promptVersion,
    servedProvider,
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

/** The totals of the generation journal. Mirrors `attemptTotals`, and for the same reasons. */
export type BeautifyTotals = {
  attempts: number
  pending: number
  accepted: number
  rejected: number
  discarded: number
  technicalFailures: number
  failureRate: number
  totalCostUsd: number
  averageCostUsd: number
  averageLatencyMs: number
  unreportedCostCalls: number
  excessiveCostCalls: number
}

/**
 * The bottom line of the generation journal. Rates and averages are weighted by the number of calls
 * in each group, never averaged across groups — a configuration tried twice must not weigh as much as
 * one tried two hundred times.
 *
 * `NonEmpty` for the same reason as `attemptTotals`: there is no bottom line under nothing, and the
 * caller has already made that check to decide whether to draw a table at all.
 */
export function beautifyTotals(
  groups: NonEmpty<BeautifySummary>,
): BeautifyTotals {
  const sum = (pick: (group: BeautifySummary) => number) =>
    groups.reduce((total, group) => total + pick(group), 0)

  const attempts = sum((group) => group.attempts)
  const technicalFailures = sum((group) => group.technicalFailures)
  const totalCostUsd = sum((group) => group.totalCostUsd)
  // Reconstructed from each group's average, which is the only latency the wire carries.
  const latencySum = sum((group) => group.averageLatencyMs * group.attempts)

  return {
    attempts,
    pending: sum((group) => group.pending),
    accepted: sum((group) => group.accepted),
    rejected: sum((group) => group.rejected),
    discarded: sum((group) => group.discarded),
    technicalFailures,
    failureRate: technicalFailures / attempts,
    totalCostUsd,
    averageCostUsd: totalCostUsd / attempts,
    averageLatencyMs: latencySum / attempts,
    unreportedCostCalls: sum((group) => group.unreportedCostCalls),
    excessiveCostCalls: sum((group) => group.excessiveCostCalls),
  }
}
