import { describe, expect, it } from "vitest";

import { type Extraction } from "../src/lib/recipe-schema.js";
import { acceptText, mergeCorrection } from "./correct.js";

const original: Extraction = {
  recipes: [
    {
      title: "Dinde aux piments et au cacao",
      type: "plat",
      servings: 6,
      ingredients: [
        { raw: "2 filets de dinde de 500 g", quantity: 2, unit: null, label: null },
        { raw: "20 g de cacao brut", quantity: 20, unit: "g", label: "cacao brut" },
      ],
      steps: ["Pivrez, salez et laissez mijoter 20 min.", "Par-semez le plat de sésame."],
    },
  ],
};

function corrected(overrides: Partial<Extraction["recipes"][number]>): unknown {
  return { recipes: [{ ...original.recipes[0]!, ...overrides }] };
}

describe("correction pass", () => {
  it("keeps a typo fix and reports it", () => {
    const { value, corrections } = mergeCorrection({
      original,
      corrected: corrected({ steps: ["Poivrez, salez et laissez mijoter 20 min.", "Parsemez le plat de sésame."] }),
    });
    expect(value.recipes[0]?.steps).toEqual(["Poivrez, salez et laissez mijoter 20 min.", "Parsemez le plat de sésame."]);
    expect(corrections).toHaveLength(2);
    expect(corrections[0]?.path).toBe("recipes.0.steps.0");
  });

  // The cheapest guardrail against the costliest drift: a typo never moves a digit, so "500 g" read
  // back as "50 g" is a rewrite pretending to be a correction.
  it("refuses a correction that moves a digit", () => {
    const { value, corrections } = mergeCorrection({
      original,
      corrected: corrected({
        ingredients: [
          { raw: "2 filets de dinde de 50 g", quantity: 2, unit: null, label: null },
          original.recipes[0]!.ingredients[1]!,
        ],
      }),
    });
    expect(value.recipes[0]?.ingredients[0]?.raw).toBe("2 filets de dinde de 500 g");
    expect(corrections).toEqual([]);
  });

  it("refuses a rewrite dressed up as a correction", () => {
    expect(
      acceptText({ original: "Pivrez, salez et laissez mijoter 20 min.", corrected: "Assaisonnez puis cuisez." }),
    ).toBe("Pivrez, salez et laissez mijoter 20 min.");
  });

  // A pass that returns a different shape has re-extracted rather than proofread; the first
  // extraction stands, since its segmentation is exactly what the ladder validated.
  it("discards a pass that changes any count", () => {
    const dropped = mergeCorrection({ original, corrected: corrected({ steps: ["Poivrez, salez."] }) });
    expect(dropped.value).toEqual(original);
    expect(dropped.corrections).toEqual([]);

    const extraRecipe = mergeCorrection({
      original,
      corrected: { recipes: [original.recipes[0]!, original.recipes[0]!] },
    });
    expect(extraRecipe.value).toEqual(original);
  });

  it("leaves numeric fields alone even when the pass alters them", () => {
    const { value } = mergeCorrection({ original, corrected: corrected({ servings: 12 }) });
    expect(value.recipes[0]?.servings).toBe(6);
  });
});
