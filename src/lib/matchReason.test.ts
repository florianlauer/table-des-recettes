import { describe, expect, test } from "vitest";
import { toSearchTokens } from "./normalize";
import { findMatchingIngredient } from "./matchReason";

const ingredients = [{ raw: "3 courgettes" }, { raw: "200 g de chorizo" }];

describe("findMatchingIngredient", () => {
  test("rend la ligne d'ingrédient qui explique la correspondance", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("courgette"))).toBe(
      "3 courgettes",
    );
  });

  test("ne rend rien quand le titre explique déjà", () => {
    expect(
      findMatchingIngredient("Gratin de courgettes", ingredients, toSearchTokens("courgette")),
    ).toBeNull();
  });

  test("ne confond pas un fragment de mot", () => {
    expect(findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("riz"))).toBeNull();
  });

  test("requête vide", () => {
    expect(findMatchingIngredient("Gratin", ingredients, "")).toBeNull();
  });

  test("sur plusieurs termes, explique celui que le titre n'explique pas", () => {
    expect(
      findMatchingIngredient(
        "Gratin de courgettes",
        ingredients,
        toSearchTokens("courgette chorizo"),
      ),
    ).toBe("200 g de chorizo");
  });

  test("le premier terme inexpliqué gagne, dans l'ordre des ingrédients", () => {
    expect(
      findMatchingIngredient("Gratin du jardin", ingredients, toSearchTokens("chorizo courgette")),
    ).toBe("3 courgettes");
  });
});
