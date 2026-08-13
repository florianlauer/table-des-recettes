import { describe, expect, it } from 'vitest'
import { searchStatusLine } from './searchStatusLine'

describe('searchStatusLine', () => {
  it('says nothing when nothing restricts the index', () => {
    expect(searchStatusLine({ count: 203 })).toBeNull()
    expect(searchStatusLine({ count: 203, query: '   ' })).toBeNull()
  })

  it('names a typed restriction', () => {
    expect(searchStatusLine({ count: 2, query: 'courgette' })).toBe(
      '2 résultats pour « courgette »',
    )
  })

  it('names a filter alone, quoted by the label its button shows', () => {
    expect(searchStatusLine({ count: 94, type: 'plat' })).toBe(
      '94 résultats dans « Plats »',
    )
  })

  it('names both restrictions when both apply', () => {
    expect(
      searchStatusLine({ count: 1, query: 'courgette', type: 'entree' }),
    ).toBe('1 résultat pour « courgette » dans « Entrées »')
  })

  it('counts in the singular, and zero in the plural the French way', () => {
    expect(searchStatusLine({ count: 1, query: 'kiwi' })).toBe(
      '1 résultat pour « kiwi »',
    )
    expect(searchStatusLine({ count: 0, query: 'kiwi' })).toBe(
      '0 résultat pour « kiwi »',
    )
  })
})
