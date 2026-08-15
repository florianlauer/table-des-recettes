/**
 * What a generation is expected to cost, and when a bill is worth an alert.
 *
 * Its own module rather than a corner of `beautifyPrompt`: the journal that reads this is displayed
 * in the browser, so importing it from there put the prompt — 1,5 kB of French instructions the
 * browser never uses — into the browser's import graph. Rollup tree-shook it back out; the point is
 * that the rule should not depend on the bundler being able to prove that.
 *
 * Per-call cost measured by the bench, unchanged between v2 and v4 — 0,03936 to 0,03959 across the
 * twelve v4 cells. The alert compares against a multiple of it; it never prevents a call, since the
 * price is only known once the answer is billed. Two calls of that campaign crossed the threshold,
 * one at 0,233 USD, so the alert is not a precaution against a hypothesis.
 */
export const BEAUTIFY_EXPECTED_COST_USD = 0.03944
export const BEAUTIFY_COST_ALERT_FACTOR = 3

export function costLooksExcessive(costUsd: number): boolean {
  return costUsd > BEAUTIFY_EXPECTED_COST_USD * BEAUTIFY_COST_ALERT_FACTOR
}
