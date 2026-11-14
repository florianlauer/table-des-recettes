// Single source for the failure taxonomy, like RECIPE_TYPES is for dish types: the TypeScript
// union, the stored validator and the admin API validator all derive from this tuple.
export const FAILURE_KINDS = [
  'refusal',
  'truncated',
  // Google's filter on verbatim reproduction of published text: retrying the same model cuts at the
  // same place, so only the fallback model gets past it.
  'recitation',
  'invalid_json',
  'invalid_schema',
  'timeout',
  'transport',
  'no_recipes',
  'invalid_image',
] as const

export type FailureKind = (typeof FAILURE_KINDS)[number]

// A kind is terminal when retrying the same bytes cannot change the outcome. The spike measured
// four of eight models answering differently to identical calls, so everything else is retryable.
export function isTerminalFailure(kind: FailureKind): boolean {
  return kind === 'invalid_image'
}
