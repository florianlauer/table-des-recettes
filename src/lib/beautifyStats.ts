/**
 * What the beautification journal says about the model in use. Deliberately not `attemptSummary`:
 * that one keys on a `schemaVersion` no image has, and it has no notion of what a human decided of
 * the result — which is the whole question here. A model that never fails technically and gets
 * rejected nine times out of ten is failing.
 */
import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import { costLooksExcessive } from './beautifyPrompt'

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

/** Attempts must arrive newest first: group order is preserved, so the combination in force reads
 * above the ones it replaced. */
export function summarizeBeautifyAttempts(
  attempts: JournalledBeautifyAttempt[],
): BeautifySummary[] {
  const groups = new Map<
    string,
    [JournalledBeautifyAttempt, ...JournalledBeautifyAttempt[]]
  >()
  for (const attempt of attempts) {
    const group = groups.get(beautifyGroupKey(attempt))
    if (group) group.push(attempt)
    else groups.set(beautifyGroupKey(attempt), [attempt])
  }
  return [...groups.values()].map(summarizeGroup)
}

function summarizeGroup(
  rows: readonly [JournalledBeautifyAttempt, ...JournalledBeautifyAttempt[]],
): BeautifySummary {
  const { model, promptVersion } = rows[0]
  const count = (keep: (row: JournalledBeautifyAttempt) => boolean) =>
    rows.filter(keep).length
  const sum = (pick: (row: JournalledBeautifyAttempt) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)

  const kinds = new Map<string, number>()
  for (const row of rows)
    if (row.failureKind !== null)
      kinds.set(row.failureKind, (kinds.get(row.failureKind) ?? 0) + 1)
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
    failureKinds: [...kinds]
      .map(([kind, count_]) => ({ kind, count: count_ }))
      .sort(
        (left, right) =>
          right.count - left.count || (left.kind < right.kind ? -1 : 1),
      ),
    totalCostUsd: sum((row) => row.costUsd),
    averageCostUsd: sum((row) => row.costUsd) / rows.length,
    averageLatencyMs: sum((row) => row.latencyMs) / rows.length,
    unreportedCostCalls: count((row) => !row.costReported),
    excessiveCostCalls: count(
      (row) => row.costReported && costLooksExcessive(row.costUsd),
    ),
  }
}
