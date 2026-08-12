import { describe, expect, it } from 'vitest'
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT_VERSION } from './beautifyPrompt'
import {
  configuredBeautifyIdentity,
  configuredExtractionIdentity,
  isCurrentAttemptGroup,
  isCurrentBeautifyGroup,
} from './currentIdentity'
import { PROMPT_VERSION } from './recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from './recipe-schema'

const environment = {
  OPENROUTER_MODEL: 'a/model',
  OPENROUTER_PROVIDER: 'google-ai-studio',
}

const group = {
  model: 'a/model',
  servedProvider: 'Google AI Studio',
  promptVersion: PROMPT_VERSION,
  schemaVersion: RECIPE_SCHEMA_VERSION,
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

  it('has no identity when the model alone is set', () => {
    expect(
      configuredExtractionIdentity({ OPENROUTER_MODEL: 'a/model' }),
    ).toBeNull()
  })

  it('has no identity when the provider alone is set', () => {
    expect(
      configuredExtractionIdentity({ OPENROUTER_PROVIDER: 'google-ai-studio' }),
    ).toBeNull()
  })

  it('has no identity on an unconfigured deployment', () => {
    expect(configuredExtractionIdentity({})).toBeNull()
  })
})

describe('isCurrentAttemptGroup', () => {
  const identity = configuredExtractionIdentity(environment)

  it('matches the pinned slug against the served display name', () => {
    expect(isCurrentAttemptGroup(group, identity)).toBe(true)
  })

  it('rejects another model', () => {
    expect(isCurrentAttemptGroup({ ...group, model: 'other' }, identity)).toBe(
      false,
    )
  })

  it('rejects another provider', () => {
    expect(
      isCurrentAttemptGroup({ ...group, servedProvider: 'Together' }, identity),
    ).toBe(false)
  })

  it('rejects a stale prompt version', () => {
    expect(
      isCurrentAttemptGroup({ ...group, promptVersion: 'v1' }, identity),
    ).toBe(false)
  })

  it('rejects a stale schema version', () => {
    expect(
      isCurrentAttemptGroup({ ...group, schemaVersion: '1' }, identity),
    ).toBe(false)
  })

  it('rejects a group whose provider was never reported', () => {
    expect(
      isCurrentAttemptGroup({ ...group, servedProvider: null }, identity),
    ).toBe(false)
  })

  it('marks nothing when nothing is configured', () => {
    expect(isCurrentAttemptGroup(group, null)).toBe(false)
  })
})

describe('beautification identity', () => {
  it('reads the model and prompt the code pins', () => {
    expect(configuredBeautifyIdentity()).toEqual({
      model: BEAUTIFY_MODEL,
      promptVersion: BEAUTIFY_PROMPT_VERSION,
    })
  })

  it('marks the current model whatever provider served it', () => {
    const identity = configuredBeautifyIdentity()
    expect(
      isCurrentBeautifyGroup(
        { model: BEAUTIFY_MODEL, promptVersion: BEAUTIFY_PROMPT_VERSION },
        identity,
      ),
    ).toBe(true)
  })

  it('rejects a superseded prompt version', () => {
    expect(
      isCurrentBeautifyGroup(
        { model: BEAUTIFY_MODEL, promptVersion: 'v1' },
        configuredBeautifyIdentity(),
      ),
    ).toBe(false)
  })
})
