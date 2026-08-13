import { describe, expect, test } from 'vitest'
import { trimIngredientLine } from './ingredientLine'

describe('trimIngredientLine', () => {
  test('drops the list comma', () => {
    expect(trimIngredientLine('12 petites pêches nectarines,')).toBe(
      '12 petites pêches nectarines',
    )
  })

  test('drops the closing period', () => {
    expect(trimIngredientLine('1/2 litre de glace à la vanille.')).toBe(
      '1/2 litre de glace à la vanille',
    )
  })

  test('drops a leading bullet', () => {
    expect(trimIngredientLine('— 100 g de sucre')).toBe('100 g de sucre')
  })

  test('keeps a closing parenthesis', () => {
    expect(
      trimIngredientLine('60 g de pâte de pistaches (ou des vertes),'),
    ).toBe('60 g de pâte de pistaches (ou des vertes)')
  })

  test('keeps a trailing percentage', () => {
    expect(trimIngredientLine('20 cl de crème à 30%')).toBe(
      '20 cl de crème à 30%',
    )
  })

  test('leaves inner punctuation alone', () => {
    expect(trimIngredientLine('sel, poivre,')).toBe('sel, poivre')
  })

  test('keeps a line made only of separators', () => {
    expect(trimIngredientLine(' --- ')).toBe('---')
  })
})
