import { describe, expect, test } from 'vitest'
import {
  ILLUSTRATION_WORK_LISTED,
  ILLUSTRATION_WORK_MAX,
  boundedLimit,
} from './illustrationLimits'

describe('boundedLimit', () => {
  test('passes a plain request through', () => {
    expect(boundedLimit(50)).toBe(50)
    expect(boundedLimit(0)).toBe(0)
    expect(boundedLimit(ILLUSTRATION_WORK_MAX)).toBe(ILLUSTRATION_WORK_MAX)
  })

  test('clamps above the hard ceiling', () => {
    expect(boundedLimit(10_000)).toBe(ILLUSTRATION_WORK_MAX)
  })

  test('clamps a negative request to zero rather than passing it to take', () => {
    expect(boundedLimit(-1)).toBe(0)
  })

  test('floors a decimal request', () => {
    expect(boundedLimit(1.5)).toBe(1)
    expect(boundedLimit(49.9)).toBe(49)
  })

  // A client bug should not make the screen look empty, so a nonsense request falls back to the
  // default page rather than to zero.
  test('falls back to the default page on a non-finite request', () => {
    expect(boundedLimit(Number.NaN)).toBe(ILLUSTRATION_WORK_LISTED)
    expect(boundedLimit(Number.POSITIVE_INFINITY)).toBe(
      ILLUSTRATION_WORK_LISTED,
    )
    expect(boundedLimit(Number.NEGATIVE_INFINITY)).toBe(
      ILLUSTRATION_WORK_LISTED,
    )
  })
})
