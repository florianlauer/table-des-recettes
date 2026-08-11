/**
 * What the extraction journal says about the model in use. The spike measured 0,0049 USD and 7,1 s
 * per call on seven pages; this is how the same figures get read back from real recipes, so a drift
 * in cost, failure rate or correction volume shows up before it becomes a habit.
 */
import { v } from 'convex/values'
import type { Infer } from 'convex/values'

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

/**
 * Attempts must arrive newest first: the insertion order of the groups is preserved so the
 * combination in force reads above the ones it replaced.
 */
export function summarizeAttempts(
  attempts: JournalledAttempt[],
): AttemptSummary[] {
  // A non-empty tuple, so each group's identity can be read off its first row without a cast.
  const groups = new Map<string, [JournalledAttempt, ...JournalledAttempt[]]>()
  for (const attempt of attempts) {
    const group = groups.get(groupKey(attempt))
    if (group) group.push(attempt)
    else groups.set(groupKey(attempt), [attempt])
  }
  return [...groups.values()].map(summarizeGroup)
}

function summarizeGroup(
  rows: readonly [JournalledAttempt, ...JournalledAttempt[]],
): AttemptSummary {
  const { model, promptVersion, schemaVersion } = rows[0]
  // Billed even when rejected, so a failing attempt still counts towards the cost.
  const sum = (pick: (row: JournalledAttempt) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)

  const kinds = new Map<string, number>()
  for (const row of rows)
    if (row.failureKind !== null)
      kinds.set(row.failureKind, (kinds.get(row.failureKind) ?? 0) + 1)
  const failures = sum((row) => (row.failureKind === null ? 0 : 1))

  return {
    model,
    promptVersion,
    schemaVersion,
    attempts: rows.length,
    failures,
    failureRate: failures / rows.length,
    failureKinds: [...kinds]
      .map(([kind, count]) => ({ kind, count }))
      .sort(
        (left, right) =>
          right.count - left.count || (left.kind < right.kind ? -1 : 1),
      ),
    repairs: sum((row) => row.repairCount),
    repairedAttempts: sum((row) => (row.repairCount > 0 ? 1 : 0)),
    totalCostUsd: sum((row) => row.costUsd),
    averageCostUsd: sum((row) => row.costUsd) / rows.length,
    averageLatencyMs: sum((row) => row.latencyMs) / rows.length,
  }
}
