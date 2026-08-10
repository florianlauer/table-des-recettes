import { v } from 'convex/values'
import type { Validator } from 'convex/values'

type LiteralTuple = readonly [string, string, ...string[]]

/**
 * Derives a Convex union validator from a tuple of string literals, so a taxonomy declared once in
 * TypeScript never has to be retyped as validators. `v.union` wants its members as a tuple rather
 * than an array, and mapping over a tuple widens it, so the cast lives here — once — instead of
 * being hand-written at each call site.
 */
export function literalUnion<const T extends LiteralTuple>(values: T) {
  const members = values.map((value) => v.literal(value)) as unknown as [
    Validator<T[number]>,
    Validator<T[number]>,
    ...Validator<T[number]>[],
  ]
  return v.union(...members)
}
