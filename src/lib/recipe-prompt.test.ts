import { describe, expect, test } from 'vitest'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from './recipe-prompt'

describe('recipe prompt', () => {
  test('versions and states both inference branches explicitly', () => {
    expect(PROMPT_VERSION).toBe('v3')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à true')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à false')
    expect(EXTRACTION_PROMPT).toContain("n'imprime aucune liste d'ingrédients")
  })
})
