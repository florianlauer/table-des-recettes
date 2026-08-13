import { describe, expect, it } from 'vitest'
import { indexStatusLine } from './indexStatusLine'

describe('indexStatusLine', () => {
  it('says nothing when nothing restricts the index', () => {
    expect(indexStatusLine({ count: 203 })).toBeNull()
    expect(indexStatusLine({ count: 203, query: '   ' })).toBeNull()
  })

  it('names a typed restriction', () => {
    expect(indexStatusLine({ count: 2, query: 'courgette' })).toBe(
      '2 résultats pour « courgette »',
    )
  })

  it('names a filter alone, quoted by the label its button shows', () => {
    expect(indexStatusLine({ count: 94, type: 'plat' })).toBe(
      '94 résultats dans « Plats »',
    )
  })

  it('names both restrictions when both apply', () => {
    expect(
      indexStatusLine({ count: 1, query: 'courgette', type: 'entree' }),
    ).toBe('1 résultat pour « courgette » dans « Entrées »')
  })

  it('counts in the singular', () => {
    expect(indexStatusLine({ count: 1, query: 'kiwi' })).toBe(
      '1 résultat pour « kiwi »',
    )
  })

  it('states the absence rather than counting it, and names what to undo', () => {
    expect(indexStatusLine({ count: 0, query: ' courgette ' })).toBe(
      'Aucune recette ne correspond à « courgette ».',
    )
    expect(indexStatusLine({ count: 0, type: 'petitDej' })).toBe(
      'Aucune recette dans « Petits-déjeuners ».',
    )
    expect(
      indexStatusLine({ count: 0, query: 'courgette', type: 'plat' }),
    ).toBe('Aucune recette ne correspond à « courgette » dans « Plats ».')
  })
})
