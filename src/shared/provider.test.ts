import { describe, expect, it } from 'vitest'
import { normalizeProviderIdentifier } from './provider'

describe('normalizeProviderIdentifier', () => {
  it('makes the pinned slug and the served display name comparable', () => {
    expect(normalizeProviderIdentifier('google-ai-studio')).toBe(
      normalizeProviderIdentifier('Google AI Studio'),
    )
  })

  it('folds underscores and repeated spaces', () => {
    expect(normalizeProviderIdentifier('google_ai  studio')).toBe(
      'googleaistudio',
    )
  })

  it('keeps distinct providers distinct', () => {
    expect(normalizeProviderIdentifier('google-vertex')).not.toBe(
      normalizeProviderIdentifier('google-ai-studio'),
    )
  })

  it('lowercases in English, so a Turkish locale cannot turn I into ı', () => {
    expect(normalizeProviderIdentifier('AI21')).toBe('ai21')
  })
})
