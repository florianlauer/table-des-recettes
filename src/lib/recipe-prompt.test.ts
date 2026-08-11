import { describe, expect, test } from 'vitest'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from './recipe-prompt'

describe('recipe prompt', () => {
  test('versions and states both inference branches explicitly', () => {
    expect(PROMPT_VERSION).toBe('v5')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à true')
    expect(EXTRACTION_PROMPT).toContain('ingredientsInferred à false')
    expect(EXTRACTION_PROMPT).toContain("n'imprime aucune liste d'ingrédients")
  })

  test('tells the model that several images are pages of one source', () => {
    expect(EXTRACTION_PROMPT).toContain(
      'pages d’une même source'.replace('’', "'"),
    )
    expect(EXTRACTION_PROMPT).toContain('à cheval sur deux')
    expect(EXTRACTION_PROMPT).toContain('rends-la une seule fois')
  })
})
