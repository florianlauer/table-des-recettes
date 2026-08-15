/**
 * What the two journals — extraction and beautification — have in common: how their rows are
 * counted, which of their groups describes the configuration in service, and how long a call under
 * that configuration usually takes.
 *
 * Their summaries genuinely differ (one keys on a schema version, the other carries a human verdict)
 * and that is why there are still two summarizers. Everything under them did not differ, and used to
 * be spread over four modules — a rule for "in service" per journal, an adapter for provider names,
 * an estimate that only ever read the flag those rules set.
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

/**
 * What a deployment pins, whichever journal is being read. A field left out is a field this journal
 * does not pin: beautification names no provider and has no schema, so neither splits what counts as
 * in service for it. Two predicates used to say that, one per journal, differing by which lines they
 * left out.
 */
export type ServiceIdentity = {
  model: string
  promptVersion: string
  schemaVersion?: string
  provider?: string
}

/**
 * The one place where OpenRouter's two namespaces meet: a request pins a provider *slug*
 * (`google-ai-studio`) and a response names the provider it *served* (`Google AI Studio`). Comparing
 * them directly never matches, and a comparison that never matches here would silently mark every
 * journal group as not-current — no error, no log, just an estimate that never appears.
 *
 * Copied out of `spike/openrouter.ts` rather than imported: the bench is not application code.
 */
export function normalizeProviderIdentifier(provider: string): string {
  return provider.toLocaleLowerCase('en').replace(/[\s_-]/g, '')
}

/** The fields of a group that a pinned identity can be compared against. */
export type JournalGroupIdentity = {
  model: string
  promptVersion: string
  schemaVersion?: string
  servedProvider: string | null
}

function isCurrentGroup(
  group: JournalGroupIdentity,
  identity: ServiceIdentity | null,
): boolean {
  // A half-configured deployment pins nothing, so nothing of it is in service — and therefore no
  // estimate is drawn from a configuration it cannot name.
  if (identity === null) return false
  if (group.model !== identity.model) return false
  // All the pinned fields, not just the model: comparing the model alone would keep an old group
  // current across a prompt bump — `BEAUTIFY_PROMPT_VERSION` moved from v3 to v4 while the screen
  // that reads this was being designed.
  if (group.promptVersion !== identity.promptVersion) return false
  if (
    identity.schemaVersion !== undefined &&
    group.schemaVersion !== identity.schemaVersion
  )
    return false
  if (identity.provider === undefined) return true
  return (
    group.servedProvider !== null &&
    normalizeProviderIdentifier(group.servedProvider) ===
      normalizeProviderIdentifier(identity.provider)
  )
}

/**
 * Marks the groups that describe the configuration in service. Server-side only: what a deployment
 * pins comes from its environment and its own constants, so the browser cannot work it out — it only
 * ever consumes the flag this puts on each group.
 */
export function markCurrent<T extends JournalGroupIdentity>(
  groups: readonly T[],
  identity: ServiceIdentity | null,
): (T & { isCurrent: boolean })[] {
  return groups.map((group) => ({
    ...group,
    isCurrent: isCurrentGroup(group, identity),
  }))
}

/** Under this many journalled calls, the average is noise and the screen shows no bar. */
export const MIN_ESTIMATE_SAMPLE = 3

export type EstimateGroup = {
  attempts: number
  averageLatencyMs: number
  isCurrent: boolean
}

/**
 * How long a call *usually* takes, read off the journal the admin already displays: an
 * attempts-weighted mean over the groups in service. Extraction has one in practice; beautification
 * can have several, one per provider actually served, because it pins none.
 *
 * Averaging the whole journal would describe a model that has been retired — and it would do so
 * precisely on the day someone changes model or provider, which is the day the screen is watched.
 */
export function estimateFrom(groups: readonly EstimateGroup[]): number | null {
  let attempts = 0
  let totalMs = 0
  for (const group of groups) {
    if (!group.isCurrent) continue
    if (!Number.isFinite(group.attempts) || group.attempts <= 0) continue
    if (!Number.isFinite(group.averageLatencyMs) || group.averageLatencyMs <= 0)
      continue
    attempts += group.attempts
    totalMs += group.averageLatencyMs * group.attempts
  }
  if (attempts < MIN_ESTIMATE_SAMPLE) return null
  return totalMs / attempts
}
