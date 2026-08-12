// The image taxonomy, deliberately not `FAILURE_KINDS`. Three of that tuple's members —
// `invalid_json`, `invalid_schema`, `no_recipes` — describe a JSON extraction and can never happen
// here, and `no_image` (the model answered in words) has no equivalent there.
export const BEAUTIFY_FAILURE_KINDS = [
  'refusal',
  'truncated',
  'no_image',
  'timeout',
  'transport',
  'invalid_image',
] as const

export type BeautifyFailureKind = (typeof BEAUTIFY_FAILURE_KINDS)[number]

/** What the T13 bench calls its decode failures, kept verbatim so the mapping stays checkable. */
export type DecodeFailureReason = 'refusal' | 'truncation' | 'no_image'

// `truncation` is the one that does not simply carry over: the bench spells it as a noun, the
// journal as a past participle, and a silent pass-through would have written a kind no validator
// accepts.
export function beautifyFailureKind(
  reason: DecodeFailureReason,
): BeautifyFailureKind {
  return reason === 'truncation' ? 'truncated' : reason
}
