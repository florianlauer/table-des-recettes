import { describe, expect, test } from 'vitest'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from './recipe-prompt'

describe('recipe prompt', () => {
  test('versions and states both inference branches explicitly', () => {
    expect(PROMPT_VERSION).toBe('v4')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à true')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à false')
    expect(EXTRACTION_PROMPT).toContain("n'imprime aucune liste d'ingrédients")
  })

  // The three things measured wrong on page E under v3, each named in the prompt rather than left to
  // the model's judgement — a reconstituted list has no printed boundary to fall back on.
  test('forbids what a reconstituted list may not contain', () => {
    expect(EXTRACTION_PROMPT).toContain(
      'une durée, une température ni un thermostat',
    )
    expect(EXTRACTION_PROMPT).toContain('deux fois le même ingrédient')
    expect(EXTRACTION_PROMPT).toContain('aucun ingrédient cité dans les étapes')
  })
})
