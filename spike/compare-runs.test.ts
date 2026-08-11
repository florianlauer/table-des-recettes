import { describe, expect, test } from 'vitest'
import { diffLines, normalizeTypography } from './compare-runs.js'

describe('typographic normalization', () => {
  test('reads both apostrophes as the same ingredient', () => {
    expect(normalizeTypography('3 gousses d’ail')).toBe(
      normalizeTypography("3 gousses d'ail"),
    )
  })

  test('reads a no-break space as a space', () => {
    // Written escaped: the point is a glyph nothing distinguishes from a space on screen.
    expect(normalizeTypography('180\u00a0°C')).toBe(
      normalizeTypography('180 °C'),
    )
  })

  test('leaves a different ingredient different', () => {
    expect(normalizeTypography("3 gousses d'ail")).not.toBe(
      normalizeTypography("4 gousses d'ail"),
    )
  })
})

describe('line diff', () => {
  test('says nothing when only the typography differs', () => {
    expect(diffLines(["1 filet d'huile"], ['1 filet d’huile'], 'x')).toEqual([])
  })

  test('names the index and both sides of a real difference', () => {
    expect(diffLines(['sel'], ['poivre'], 'ingredients')).toEqual([
      'ingredients[0] baseline "sel" ≠ candidate "poivre"',
    ])
  })

  test('reports a line one side does not have', () => {
    expect(diffLines(['sel'], ['sel', 'poivre'], 'ingredients')).toEqual([
      'ingredients[1] baseline "—" ≠ candidate "poivre"',
    ])
  })
})
