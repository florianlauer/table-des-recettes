/**
 * How long a call *usually* takes, read off the journal the admin already displays.
 *
 * Only the configuration in service counts. Averaging the whole journal would describe a model that
 * has been retired — and it would do so precisely on the day someone changes model or provider,
 * which is the day the screen is being watched.
 */

/** Under this many journalled calls, the average is noise and the screen shows no bar. */
export const MIN_ESTIMATE_SAMPLE = 3

export type EstimateGroup = {
  attempts: number
  averageLatencyMs: number
  isCurrent: boolean
}

/**
 * Attempts-weighted mean over the current groups. Extraction has one in practice; beautification can
 * have several, one per provider actually served, because it pins none.
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
