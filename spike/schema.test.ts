import { describe, expect, it } from "vitest";

import { extractionSchema, normalizeExtraction } from "../src/lib/recipe-schema.js";
import { extractionJsonSchema } from "./json-schema.js";

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertStrictObjects);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (node.type === "object") {
    const properties = node.properties as Record<string, unknown>;
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(Object.keys(properties));
  }
  Object.values(node).forEach(assertStrictObjects);
}

describe("schéma d'extraction", () => {
  it("rend chaque objet strict et chaque clé obligatoire", () => {
    assertStrictObjects(extractionJsonSchema);
  });

  it("garde les champs non garantis présents mais nullables", () => {
    const sample = {
      recipes: [
        {
          title: "Soupe",
          type: "entree",
          servings: 4,
          ingredients: [{ raw: "1 carotte", quantity: 1, unit: null, label: null }],
          steps: ["Cuire."],
        },
      ],
    };
    const parsed = extractionSchema.parse(sample);
    expect(extractionSchema.safeParse({ recipes: [{ ...sample.recipes[0], servings: undefined }] }).success).toBe(false);
    expect(normalizeExtraction(parsed)).toEqual({
      recipes: [
        {
          title: "Soupe",
          type: "entree",
          servings: 4,
          ingredients: [{ raw: "1 carotte", quantity: 1, unit: undefined, label: undefined }],
          steps: ["Cuire."],
        },
      ],
    });
    expect(extractionSchema.safeParse({ recipes: [{ ...sample.recipes[0], servings: "4" }] }).success).toBe(false);
    expect(
      extractionSchema.safeParse({
        recipes: [{ ...sample.recipes[0], ingredients: [{ ...sample.recipes[0]!.ingredients[0], quantity: "1" }] }],
      }).success,
    ).toBe(false);
  });
});
