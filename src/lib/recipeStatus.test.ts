import { describe, expect, it } from 'vitest'
import {
  RECIPE_STATUSES,
  RECIPE_STATUS_LABELS,
  recipeStatusLabel,
} from './recipeStatus'

describe('recipeStatusLabel', () => {
  it('translates the stored enum instead of printing it', () => {
    expect(recipeStatusLabel('published')).toBe('publiée')
    expect(recipeStatusLabel('review')).toBe('brouillon')
  })

  it('covers every status the schema accepts', () => {
    for (const status of RECIPE_STATUSES) {
      expect(recipeStatusLabel(status)).not.toBe(status)
    }
  })
})

describe('RECIPE_STATUS_LABELS', () => {
  it('capitalises the form that opens a line', () => {
    expect(RECIPE_STATUS_LABELS.published).toBe('Publiée')
    expect(RECIPE_STATUS_LABELS.review).toBe('Brouillon')
  })
})
