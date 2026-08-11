import { z } from 'zod'
import { extractionSchema, RECIPE_SCHEMA_VERSION } from './recipe-schema.js'

type JsonSchemaNode = Record<string, unknown>

export function enforceStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(enforceStrictObjects)
    return
  }
  if (value === null || typeof value !== 'object') return

  const node = value as JsonSchemaNode
  if (
    node.type === 'object' &&
    node.properties &&
    typeof node.properties === 'object'
  ) {
    node.additionalProperties = false
    node.required = Object.keys(node.properties)
  }
  Object.values(node).forEach(enforceStrictObjects)
}

/**
 * Structured output in strict mode accepts a narrow keyword set: `maxItems` reaches it from the
 * `recipes` bound and gets the whole request rejected. The bound is ours to enforce at validation,
 * not the model's to honour.
 */
export function stripArrayBounds(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripArrayBounds)
    return
  }
  if (value === null || typeof value !== 'object') return

  const node = value as JsonSchemaNode
  delete node.maxItems
  delete node.minItems
  Object.values(node).forEach(stripArrayBounds)
}

export const extractionJsonSchema = z.toJSONSchema(extractionSchema, {
  target: 'draft-7',
}) as JsonSchemaNode

enforceStrictObjects(extractionJsonSchema)
stripArrayBounds(extractionJsonSchema)

export const JSON_SCHEMA_NAME = `recipe_extraction_v${RECIPE_SCHEMA_VERSION}`
