import { describe, expect, test } from "vitest";
import { toSearchTokens } from "./normalize";
import { findMatchingIngredient } from "./matchReason";

const ingredients = [{ raw: "3 courgettes" }, { raw: "200 g de chorizo" }];

describe("findMatchingIngredient", () => {
  test("returns the ingredient line that explains the match", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("courgette"))).toBe(
      "3 courgettes",
    );
  });

  test("returns nothing when the title already explains the match", () => {
    expect(
      findMatchingIngredient("Gratin de courgettes", ingredients, toSearchTokens("courgette")),
    ).toBeNull();
  });

  test("does not match on a word fragment", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("riz"))).toBeNull();
  });

  test("empty query", () => {
    expect(findMatchingIngredient("Gratin", ingredients, "")).toBeNull();
  });

  test("across several terms, explains the one the title does not", () => {
    expect(
      findMatchingIngredient(
        "Gratin de courgettes",
        ingredients,
        toSearchTokens("courgette chorizo"),
      ),
    ).toBe("200 g de chorizo");
  });

  test("the first unexplained term wins, in ingredient order", () => {
    expect(
      findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("chorizo courgette")),
    ).toBe("3 courgettes");
  });
});
