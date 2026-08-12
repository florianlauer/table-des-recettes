/**
 * What the extraction journal says about the model in use. The spike measured 0,0049 USD and 7,1 s
 * per call on seven pages; this is how the same figures get read back from real recipes, so a drift
 * in cost, failure rate or correction volume shows up before it becomes a habit.
 */
import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import {
  costAndLatency,
  countFailureKinds,
  groupByIdentity,
} from './journalStats'
import type { NonEmpty } from './journalStats'

// Enough attempts to read a trend over a few dozen recipes — the horizon the plan sets for judging
// whether the cheap model holds — and few enough to stay one indexed read.
export const ATTEMPTS_SAMPLED = 200

/** The subset of a journal row this reading needs — the rest is diagnosis, not trend. */
export type JournalledAttempt = {
  model: string
  promptVersion: string
  schemaVersion: string
  failureKind: string | null
  costUsd: number
  latencyMs: number
  repairCount: number
}

/**
 * The wire shape is declared once, as a validator, and the TypeScript type is inferred from it —
 * not the other way round. Convex does **not** check a handler's return against its `returns`
 * validator at compile time (verified: dropping a field from the validator typechecks clean and only
 * fails at test time), so a hand-kept second copy of this shape would be unguarded duplication.
 */
export const attemptSummary = v.object({
  model: v.string(),
  promptVersion: v.string(),
  schemaVersion: v.string(),
  attempts: v.number(),
  failures: v.number(),
  failureRate: v.number(),
  failureKinds: v.array(v.object({ kind: v.string(), count: v.number() })),
  repairs: v.number(),
  repairedAttempts: v.number(),
  totalCostUsd: v.number(),
  averageCostUsd: v.number(),
  averageLatencyMs: v.number(),
})

export type AttemptSummary = Infer<typeof attemptSummary>

/** The three things that change the answer, and nothing else. */
export type AttemptIdentity = Pick<
  JournalledAttempt,
  'model' | 'promptVersion' | 'schemaVersion'
>

/** Built here rather than at each call site, so a row and its summary cannot key differently. */
export function groupKey({
  model,
  promptVersion,
  schemaVersion,
}: AttemptIdentity): string {
  return `${model} ${promptVersion} ${schemaVersion}`
}

export function summarizeAttempts(
  attempts: JournalledAttempt[],
): AttemptSummary[] {
  return groupByIdentity(attempts, groupKey).map(summarizeGroup)
}

function summarizeGroup(rows: NonEmpty<JournalledAttempt>): AttemptSummary {
  const { model, promptVersion, schemaVersion } = rows[0]
  const sum = (pick: (row: JournalledAttempt) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)
  const failures = sum((row) => (row.failureKind === null ? 0 : 1))

  return {
    model,
    promptVersion,
    schemaVersion,
    attempts: rows.length,
    failures,
    failureRate: failures / rows.length,
    failureKinds: countFailureKinds(rows),
    repairs: sum((row) => row.repairCount),
    repairedAttempts: sum((row) => (row.repairCount > 0 ? 1 : 0)),
    ...costAndLatency(rows),
  }
}
