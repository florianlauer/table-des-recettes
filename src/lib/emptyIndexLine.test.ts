import { describe, expect, it } from 'vitest'
import { emptyIndexLine } from './emptyIndexLine'

describe('emptyIndexLine', () => {
  it('names both restrictions when both are on', () => {
    expect(emptyIndexLine({ query: 'courgette', type: 'plat' })).toBe(
      'Aucune recette ne correspond à « courgette » dans « Plats ».',
    )
  })

  it('names the search alone', () => {
    expect(emptyIndexLine({ query: ' courgette ' })).toBe(
      'Aucune recette ne correspond à « courgette ».',
    )
  })

  it('names the filter alone', () => {
    expect(emptyIndexLine({ type: 'petitDej' })).toBe(
      'Aucune recette dans « Petits-déjeuners ».',
    )
  })

  it('falls back to the bare sentence when nothing restricts the list', () => {
    expect(emptyIndexLine({ query: '   ' })).toBe(
      'Aucune recette ne correspond.',
    )
  })
})
