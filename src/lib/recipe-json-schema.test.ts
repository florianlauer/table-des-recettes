import { describe, expect, test } from 'vitest'
import { extractionJsonSchema, JSON_SCHEMA_NAME } from './recipe-json-schema'

describe('recipe JSON schema', () => {
  test('requires every object field and the v2 inference signal', () => {
    expect(JSON_SCHEMA_NAME).toBe('recipe_extraction_v2')
    const root = extractionJsonSchema as {
      additionalProperties: boolean
      required: string[]
      properties: { recipes: { items: { required: string[] } } }
    }
    expect(root.additionalProperties).toBe(false)
    expect(root.required).toEqual(['recipes'])
    expect(root.properties.recipes.items.required).toContain(
      'ingredientsInferred',
    )
  })
})
