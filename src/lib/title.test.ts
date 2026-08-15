import { describe, expect, test } from 'vitest'
import { cleanTitle } from './title'

describe('cleanTitle', () => {
  test('leaves an already clean title untouched', () => {
    expect(cleanTitle('Saint-Jacques en aumônières')).toBe(
      'Saint-Jacques en aumônières',
    )
    expect(cleanTitle('Rémoulade de champignons aux huîtres')).toBe(
      'Rémoulade de champignons aux huîtres',
    )
  })

  test('collapses surrounding and repeated whitespace', () => {
    expect(cleanTitle('  Tarte  aux pommes ')).toBe('Tarte aux pommes')
  })

  test('strips the punctuation magazines print around a title', () => {
    expect(cleanTitle('— Tarte aux pommes …')).toBe('Tarte aux pommes')
    expect(cleanTitle('« Tarte aux pommes »')).toBe('Tarte aux pommes')
  })

  test('keeps punctuation that belongs to the title itself', () => {
    expect(cleanTitle('Poulet (façon grand-mère)')).toBe(
      'Poulet (façon grand-mère)',
    )
    expect(cleanTitle('Crème 40 %')).toBe('Crème 40 %')
  })

  // Safety net only: the prompt asks the model for sentence case with proper nouns and restored
  // accents, which no deterministic pass can produce. This fires when the model shouts anyway —
  // accents stay lost, and the operator fixes them in review.
  test('sentence-cases a title the model returned in capitals', () => {
    expect(cleanTitle('NOIX DE SAINT-JACQUES A LA TAPENADE')).toBe(
      'Noix de saint-jacques a la tapenade',
    )
    expect(cleanTitle('TIRAMISU')).toBe('Tiramisu')
    expect(cleanTitle('GÂTEAU AU CHOCOLAT')).toBe('Gâteau au chocolat')
  })

  test('leaves a mixed-case title alone even with several capitals', () => {
    expect(cleanTitle('Tarte Tatin aux Pommes')).toBe('Tarte Tatin aux Pommes')
    expect(cleanTitle('Poulet au Grand Marnier')).toBe(
      'Poulet au Grand Marnier',
    )
  })

  test('keeps the original text when stripping would empty the title', () => {
    expect(cleanTitle(' !!! ')).toBe('!!!')
    expect(cleanTitle('')).toBe('')
  })
})
