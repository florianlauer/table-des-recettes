import { describe, expect, test } from 'vitest'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from './recipe-prompt'

describe('recipe prompt', () => {
  test('versions and states both inference branches explicitly', () => {
    expect(PROMPT_VERSION).toBe('v6')
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

  // The deterministic pass can lower capitals but cannot restore a lost accent or recognise a proper
  // noun, so the prompt has to carry those two rules itself.
  test('states the typography expected of a title', () => {
    expect(EXTRACTION_PROMPT).toContain('casse de phrase')
    expect(EXTRACTION_PROMPT).toContain(
      'Ne recopie jamais un titre en capitales',
    )
    expect(EXTRACTION_PROMPT).toContain("les accents que l'impression")
    expect(EXTRACTION_PROMPT).toContain('Développe les abréviations')
    expect(EXTRACTION_PROMPT).toContain('artefact de maquette')
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
