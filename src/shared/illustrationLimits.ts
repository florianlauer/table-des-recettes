/** How many rows a section shows before it reports itself capped, and the probe a collapsed section
 * uses to produce its counter. */
export const ILLUSTRATION_WORK_LISTED = 50

/**
 * The hard ceiling "Afficher 50 de plus" cannot pass. Above the whole corpus today, so the wall is
 * theoretical — but it is what stops a client-supplied limit from turning the query into a table
 * scan. The day a section reports itself capped here, cursor pagination becomes the next lot.
 */
export const ILLUSTRATION_WORK_MAX = 500

/**
 * `v.number()` is a float64: `NaN`, `Infinity`, negatives and decimals all cross the wire, and
 * `.take(NaN)` must never reach Convex. A non-finite request falls back to the default page rather
 * than to zero — a client bug should not make the screen look empty.
 */
export function boundedLimit(requested: number): number {
  if (!Number.isFinite(requested)) return ILLUSTRATION_WORK_LISTED
  return Math.min(Math.max(Math.floor(requested), 0), ILLUSTRATION_WORK_MAX)
}
