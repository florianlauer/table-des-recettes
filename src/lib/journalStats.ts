/**
 * What the two journals — extraction and beautification — count identically. Their summaries differ
 * (one keys on a schema version, the other carries a human verdict) and that is why there are two
 * summarizers; the counting underneath does not differ, so it lives here and a change to the
 * tie-break or to an average lands once instead of twice.
 */

/** A group is never empty, so its identity reads off row zero without a cast. */
export type NonEmpty<T> = readonly [T, ...T[]]

export type FailureKindCount = { kind: string; count: number }

/**
 * Rows must arrive newest first: insertion order is preserved, so the combination in force reads
 * above the ones it replaced.
 */
export function groupByIdentity<T>(
  rows: readonly T[],
  key: (row: T) => string,
): [T, ...T[]][] {
  const groups = new Map<string, [T, ...T[]]>()
  for (const row of rows) {
    const group = groups.get(key(row))
    if (group) group.push(row)
    else groups.set(key(row), [row])
  }
  return [...groups.values()]
}

/** Most frequent first, ties broken by name so the same data always reads in the same order. */
export function countFailureKinds(
  rows: readonly { failureKind: string | null }[],
): FailureKindCount[] {
  const kinds = new Map<string, number>()
  for (const row of rows)
    if (row.failureKind !== null)
      kinds.set(row.failureKind, (kinds.get(row.failureKind) ?? 0) + 1)
  return [...kinds]
    .map(([kind, count]) => ({ kind, count }))
    .sort(
      (left, right) =>
        right.count - left.count || (left.kind < right.kind ? -1 : 1),
    )
}

/** Billed even when the answer was unusable, so a failed row still counts towards the cost. */
export function costAndLatency(
  rows: NonEmpty<{ costUsd: number; latencyMs: number }>,
): { totalCostUsd: number; averageCostUsd: number; averageLatencyMs: number } {
  let totalCostUsd = 0
  let totalLatencyMs = 0
  for (const row of rows) {
    totalCostUsd += row.costUsd
    totalLatencyMs += row.latencyMs
  }
  return {
    totalCostUsd,
    averageCostUsd: totalCostUsd / rows.length,
    averageLatencyMs: totalLatencyMs / rows.length,
  }
}

/**
 * The one place a non-empty check turns into the type that says so, so nothing downstream needs a
 * cast — `length === 0` does not narrow an array to a tuple, and every caller that tried wrote the
 * cast itself.
 */
export function nonEmpty<T>(rows: readonly T[]): NonEmpty<T> | null {
  return rows.length === 0 ? null : (rows as NonEmpty<T>)
}
