import { describe, expect, it } from "vitest";

import {
  acceptanceVerdict,
  acceptanceTruthSchema,
  classifyAcceptance,
  classifyTextDifference,
  LOWER_SIMILARITY_BOUND,
  type AcceptanceTruth,
  UPPER_SIMILARITY_BOUND,
} from "./accept.js";

const truth: AcceptanceTruth = {
  recipes: [
    {
      title: "Crème brûlée",
      type: "dessert",
      servings: 4,
      ingredients: [{ raw: "50 cl de crème" }, { raw: "4 jaunes d'œufs" }],
      steps: ["Chauffez la crème.", "Mélangez les jaunes."],
    },
  ],
};

function actual(overrides: Record<string, unknown> = {}): unknown {
  return {
    recipes: [
      {
        title: truth.recipes[0]!.title,
        type: truth.recipes[0]!.type,
        servings: truth.recipes[0]!.servings,
        ingredients: truth.recipes[0]!.ingredients.map(({ raw }) => ({ raw, quantity: null, unit: null, label: null })),
        steps: [...truth.recipes[0]!.steps],
        ...overrides,
      },
    ],
  };
}

function expectHard(candidate: unknown, category: string): void {
  const result = classifyAcceptance({ actual: candidate, truth });
  expect(result.passesHardGates).toBe(false);
  expect(result.hardGates.map((issue) => issue.category)).toContain(category);
}

describe("classification d'acceptation", () => {
  it("classe les défauts structurels comme hard gates", () => {
    expectHard({ recipes: [] }, "wrong_recipe_count");
    expectHard(actual({ ingredients: [{ raw: "50 cl de crème", quantity: null, unit: null, label: null }] }), "missing_or_merged_ingredient");
    expectHard(
      actual({
        ingredients: [
          ...truth.recipes[0]!.ingredients.map(({ raw }) => ({ raw, quantity: null, unit: null, label: null })),
          { raw: "Une licorne", quantity: null, unit: null, label: null },
        ],
      }),
      "invented_ingredient",
    );
    expectHard(
      actual({
        ingredients: [
          { raw: "50 cl de crème", quantity: null, unit: null, label: null },
          { raw: "Une licorne violette", quantity: null, unit: null, label: null },
        ],
      }),
      "invented_or_missing_ingredient",
    );
    expectHard(
      actual({ ingredients: [{ raw: "50 cl de crème et 4 jaunes d'œufs", quantity: null, unit: null, label: null }] }),
      "missing_or_merged_ingredient",
    );
    expectHard(actual({ steps: [truth.recipes[0]!.steps[0]] }), "missing_step");
    expectHard(actual({ steps: [truth.recipes[0]!.steps[0], "Servez sur la lune."] }), "missing_step");
    expectHard(actual({ steps: [...truth.recipes[0]!.steps].reverse() }), "out_of_order_step");
    expectHard({ recipes: [{ title: 42 }] }, "invalid_schema");
  });

  it("refuse un servings textuel dans la vérité terrain", () => {
    expect(
      acceptanceTruthSchema.safeParse({
        recipes: [{ ...truth.recipes[0]!, servings: "4" }],
      }).success,
    ).toBe(false);
  });

  it("classe les corrections locales comme écarts éditables", () => {
    const result = classifyAcceptance({
      actual: actual({
        title: "Une creme BRULEE maison",
        type: "autre",
        servings: null,
        ingredients: [
          { raw: "50 cl de creme", quantity: null, unit: null, label: null },
          { raw: "4 JAUNES d'œufs", quantity: null, unit: null, label: null },
        ],
        steps: ["Chaufez la crème.", truth.recipes[0]!.steps[1]],
      }),
      truth,
    });
    expect(result.passesHardGates).toBe(true);
    expect(result.editableGaps.map((issue) => issue.category)).toEqual(
      expect.arrayContaining(["reformulated_title", "wrong_type", "wrong_servings", "ingredient_text", "step_text"]),
    );
  });

  it("applique les trois branches de similarité et bloque la zone d'incertitude", () => {
    expect(LOWER_SIMILARITY_BOUND).toBe(0.6);
    expect(UPPER_SIMILARITY_BOUND).toBe(0.85);
    expect(classifyTextDifference("abcdefghij", "zzzzzzzzzz")).toBe("hard_gate");
    expect(classifyTextDifference("abcdefghij", "abcdefZZZZ")).toBe("a_trancher_humain");
    expect(classifyTextDifference("abcdefghij", "abcdefghiX")).toBe("editable");

    const uncertainTruth: AcceptanceTruth = {
      recipes: [{ ...truth.recipes[0]!, ingredients: [{ raw: "abcdefghij" }] }],
    };
    const result = classifyAcceptance({
      actual: actual({ ingredients: [{ raw: "abcdefZZZZ", quantity: null, unit: null, label: null }] }),
      truth: uncertainTruth,
    });
    expect(result.passesHardGates).toBe(false);
    expect(result.hardGates).toEqual(expect.arrayContaining([expect.objectContaining({ category: "a_trancher_humain" })]));
    expect(result.humanReview).toEqual([expect.objectContaining({ category: "a_trancher_humain" })]);
  });

  it("accepte uniquement deux passes sans hard gate et fournit un code de sortie", () => {
    const clear = classifyAcceptance({ actual: actual(), truth });
    expect(
      acceptanceVerdict([
        { pass: 1, status: "success", classification: clear },
        { pass: 2, status: "success", classification: clear },
      ]),
    ).toEqual({ accepted: true, exitCode: 0, line: "ACCEPTÉ — les deux passes franchissent tous les hard gates." });

    const rejected = acceptanceVerdict([
      { pass: 1, status: "success", classification: clear },
      { pass: 2, status: "failure", classification: null },
    ]);
    expect(rejected).toMatchObject({ accepted: false, exitCode: 1 });
    expect(rejected.line).toContain("REJETÉ — passe 2: failure");
  });
});
