import { describe, expect, test } from 'vitest'
import {
  contentDrift,
  inferredListViolations,
  normalizeTypography,
  sectionLabelLines,
} from './compare-v4.js'

describe('rules v4 adds to a reconstituted ingredient list', () => {
  test('accepts the hand transcription of page E unchanged', () => {
    expect(
      inferredListViolations([
        '4 œufs',
        '2 pincées de sel',
        '25 cl de lait',
        '40 g de beurre',
        '40 g de farine',
        '1 c. à soupe de crème épaisse',
        'sel, poivre et noix muscade',
        '100 g de comté finement râpé',
      ]),
    ).toEqual([])
  })

  test('rejects the duration v3 produced on page E', () => {
    expect(inferredListViolations(['1 mn sur feu doux'])).toEqual([
      'duration as an ingredient: "1 mn sur feu doux"',
    ])
  })

  test('rejects a duration whatever unit it is written in', () => {
    for (const line of ['20 minutes', '1 h 30', '2 heures', '30 secondes'])
      expect(inferredListViolations([line])).not.toEqual([])
  })

  test('rejects a temperature and an oven setting', () => {
    expect(inferredListViolations(['four à 180 °C'])).toEqual([
      'temperature as an ingredient: "four à 180 °C"',
    ])
    expect(inferredListViolations(['thermostat 6'])).not.toEqual([])
  })

  test('rejects the eggs counted three times on page E', () => {
    expect(
      inferredListViolations(['4 œufs', "3 jaunes d'œufs", "blancs d'œufs"]),
    ).toEqual([
      '"3 jaunes d\'œufs" is a jaune of "4 œufs", already listed whole',
      '"blancs d\'œufs" is a blanc of "4 œufs", already listed whole',
    ])
  })

  test('accepts a part whose whole the list does not carry', () => {
    expect(
      inferredListViolations(["3 jaunes d'œufs", '25 cl de lait']),
    ).toEqual([])
  })

  test('rejects a juice whose fruit is already listed whole', () => {
    expect(inferredListViolations(['2 citrons', 'le jus d’un citron'])).toEqual(
      ['"le jus d’un citron" is a jus of "2 citrons", already listed whole'],
    )
  })

  test('does not read a parenthetical composition as the whole ingredient', () => {
    expect(
      inferredListViolations([
        "60 g de tranches d'agrumes confits (citrons, kumquats)",
        'jus de 1 citron vert',
      ]),
    ).toEqual([])
  })

  test('does not mistake a quantity unit for a duration', () => {
    expect(
      inferredListViolations([
        '25 cl de lait',
        '40 g de farine',
        '1 c. à soupe de crème épaisse',
        '2 pincées de sel',
      ]),
    ).toEqual([])
  })
})

describe('content drift against the hand transcription', () => {
  test('ignores where an unprinted list breaks its lines', () => {
    expect(
      contentDrift(
        ['sel, poivre et noix muscade'],
        ['sel', 'poivre', 'noix muscade'],
      ),
    ).toEqual({ missing: [], extra: [] })
  })

  test('names what a duration adds to the list', () => {
    // Asserted on the surplus rather than on the exact stems: `stemToken` shaves the trailing x of
    // `doux`, which is the stemmer's business and not this comparison's.
    const drift = contentDrift(['4 œufs'], ['4 œufs', '1 mn sur feu doux'])
    expect(drift.missing).toEqual([])
    expect(drift.extra).toContain('mn')
    expect(drift.extra).toContain('feu')
  })

  test('names what the list lost', () => {
    expect(contentDrift(['4 œufs', '25 cl de lait'], ['4 œufs'])).toEqual({
      missing: ['25', 'cl', 'lait'],
      extra: [],
    })
  })

  test('counts a repeated word as many times as it appears', () => {
    expect(contentDrift(['sel'], ['sel', 'sel'])).toEqual({
      missing: [],
      extra: ['sel'],
    })
  })
})

describe('typographic normalization', () => {
  test('reads both apostrophes as the same ingredient', () => {
    expect(normalizeTypography('3 gousses d’ail')).toBe(
      normalizeTypography("3 gousses d'ail"),
    )
  })

  test('leaves a different ingredient different', () => {
    expect(normalizeTypography("3 gousses d'ail")).not.toBe(
      normalizeTypography("4 gousses d'ail"),
    )
  })
})

describe('section labels', () => {
  test('names the labels the page B instability produced', () => {
    expect(
      sectionLabelLines([
        'Pour la pâte :',
        '200 g de farine',
        'Pour la salade :',
      ]),
    ).toEqual(['Pour la pâte :', 'Pour la salade :'])
  })

  test('leaves an ingredient line alone', () => {
    expect(sectionLabelLines(['200 g de farine', 'sel, poivre'])).toEqual([])
  })
})
