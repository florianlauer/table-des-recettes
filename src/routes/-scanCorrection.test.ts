import { describe, expect, test } from 'vitest'
import { publicationReport } from './admin_.scan.$id'

describe('publication report', () => {
  test('names every draft publication refused, and why', () => {
    // The refusals used to be phrased inside the action and then overwritten by the generic
    // success message, so the operator was told "Fait." and never learnt what stayed behind.
    expect(
      publicationReport({
        published: 2,
        refused: [
          { title: 'Tarte aux pommes', error: 'pas de titre publiable' },
          { title: '', error: 'les images du scan ont changé' },
        ],
      }),
    ).toBe(
      '2 publiées. Refusées : Tarte aux pommes (pas de titre publiable) · sans titre (les images du scan ont changé)',
    )
  })

  test('stays silent about refusals when there are none', () => {
    expect(publicationReport({ published: 3, refused: [] })).toBe('3 publiées.')
  })
})
