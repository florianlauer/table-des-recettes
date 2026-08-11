import { z } from 'zod'
import { extractionSchema, RECIPE_SCHEMA_VERSION } from './recipe-schema.js'

type JsonSchemaNode = Record<string, unknown>

/**
 * Bends the schema Zod derives into what structured output accepts in strict mode. Two rules, one
 * walk:
 *
 * - every object states its fields as required and refuses the ones it did not declare;
 * - no array bound survives. `maxItems` reaches the schema from the `recipes` cap and is a keyword
 *   strict mode rejects outright — the bound is ours to enforce when we validate the answer, not
 *   the model's to honour.
 */
export function normalizeForStrictMode(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(normalizeForStrictMode)
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
  delete node.maxItems
  delete node.minItems
  Object.values(node).forEach(normalizeForStrictMode)
}

export const extractionJsonSchema = z.toJSONSchema(extractionSchema, {
  target: 'draft-7',
}) as JsonSchemaNode

normalizeForStrictMode(extractionJsonSchema)

export const JSON_SCHEMA_NAME = `recipe_extraction_v${RECIPE_SCHEMA_VERSION}`
