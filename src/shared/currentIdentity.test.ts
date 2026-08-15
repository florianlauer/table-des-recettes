import { describe, expect, it } from 'vitest'
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT_VERSION } from './beautifyPrompt'
import {
  configuredBeautifyIdentity,
  configuredExtractionIdentity,
} from './currentIdentity'
import { PROMPT_VERSION } from './recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from './recipe-schema'

const environment = {
  OPENROUTER_MODEL: 'a/model',
  OPENROUTER_PROVIDER: 'google-ai-studio',
}

describe('configuredExtractionIdentity', () => {
  it('names the four fields that split the journal', () => {
    expect(configuredExtractionIdentity(environment)).toEqual({
      model: 'a/model',
      provider: 'google-ai-studio',
      promptVersion: PROMPT_VERSION,
      schemaVersion: RECIPE_SCHEMA_VERSION,
    })
  })

  it('pins nothing when the model is missing', () => {
    expect(
      configuredExtractionIdentity({ OPENROUTER_MODEL: 'a/model' }),
    ).toBeNull()
  })

  it('pins nothing when the provider is missing', () => {
    expect(
      configuredExtractionIdentity({ OPENROUTER_PROVIDER: 'google-ai-studio' }),
    ).toBeNull()
  })

  it('pins nothing on an unconfigured deployment', () => {
    expect(configuredExtractionIdentity({})).toBeNull()
  })
})

describe('configuredBeautifyIdentity', () => {
  it('reads the model and prompt the code pins, and pins no provider', () => {
    expect(configuredBeautifyIdentity()).toEqual({
      model: BEAUTIFY_MODEL,
      promptVersion: BEAUTIFY_PROMPT_VERSION,
    })
  })
})
