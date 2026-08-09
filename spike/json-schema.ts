import { z } from "zod";

import { extractionSchema, RECIPE_SCHEMA_VERSION } from "../src/lib/recipe-schema.js";

type JsonSchemaNode = Record<string, unknown>;

function enforceStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(enforceStrictObjects);
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const node = value as JsonSchemaNode;
  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    const properties = node.properties as Record<string, unknown>;
    node.additionalProperties = false;
    node.required = Object.keys(properties);
  }

  Object.values(node).forEach(enforceStrictObjects);
}

export const extractionJsonSchema = z.toJSONSchema(extractionSchema, {
  target: "draft-7",
}) as JsonSchemaNode;

enforceStrictObjects(extractionJsonSchema);

export const JSON_SCHEMA_NAME = `recipe_extraction_v${RECIPE_SCHEMA_VERSION}`;
