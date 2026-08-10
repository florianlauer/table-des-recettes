import { describe, expect, test } from 'vitest'
import { groupByLetter, initialLetter } from './groupByLetter'

describe('initialLetter', () => {
  test('uppercases the normalized first letter', () => {
    expect(initialLetter('crêpes')).toBe('C')
  })

  test('accents do not create a separate group', () => {
    expect(initialLetter('Éclairs')).toBe('E')
  })

  test('neither do ligatures', () => {
    expect(initialLetter('Œufs mimosa')).toBe('O')
  })

  test('a title starting with a digit falls into #', () => {
    expect(initialLetter('4 saisons')).toBe('#')
  })
})

describe('groupByLetter', () => {
  test('empty list', () => {
    expect(groupByLetter([])).toEqual([])
  })

  test('sorts and groups', () => {
    const result = groupByLetter([
      { title: 'Gratin dauphinois' },
      { title: 'Clafoutis aux cerises' },
      { title: 'Crêpes de sarrasin' },
    ])
    expect(result).toEqual([
      {
        letter: 'C',
        items: [
          { title: 'Clafoutis aux cerises' },
          { title: 'Crêpes de sarrasin' },
        ],
      },
      { letter: 'G', items: [{ title: 'Gratin dauphinois' }] },
    ])
  })

  test('a single-item group is still a valid group', () => {
    const result = groupByLetter([{ title: 'Tartiflette' }])
    expect(result).toHaveLength(1)
    expect(result[0]?.letter).toBe('T')
  })
})
