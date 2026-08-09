import { describe, expect, test } from "vitest";
import { buildSearchText, normalizeText, stemToken, toSearchTokens } from "./normalize";

describe("normalizeText", () => {
  test("retire les accents", () => {
    expect(normalizeText("Crêpes de sarrasin")).toBe("crepes de sarrasin");
  });

  test("décompose les ligatures", () => {
    expect(normalizeText("Œufs à la coque")).toBe("oeufs a la coque");
  });

  test("réduit la ponctuation et les espaces multiples", () => {
    expect(normalizeText("Tarte  fine, aux poireaux !")).toBe("tarte fine aux poireaux");
  });

  test("chaîne vide", () => {
    expect(normalizeText("   ")).toBe("");
  });
});

describe("stemToken", () => {
  test("retire le pluriel des mots de plus de trois lettres", () => {
    expect(stemToken("courgettes")).toBe("courgette");
    expect(stemToken("choux")).toBe("chou");
  });

  test("laisse les mots courts intacts", () => {
    expect(stemToken("aux")).toBe("aux");
    expect(stemToken("des")).toBe("des");
  });
});

describe("toSearchTokens", () => {
  test("singulier et pluriel produisent le même jeton", () => {
    expect(toSearchTokens("Courgettes")).toBe(toSearchTokens("courgette"));
  });
});

describe("buildSearchText", () => {
  test("concatène le titre et les lignes brutes", () => {
    const result = buildSearchText("Riz au lait", [{ raw: "200 g de riz rond" }]);
    expect(result).toContain("riz");
    expect(result).toContain("rond");
  });

  test("un ingrédient devient cherchable au pluriel comme au singulier", () => {
    const result = buildSearchText("Gratin", [{ raw: "3 courgettes" }]);
    expect(result.split(" ")).toContain(toSearchTokens("courgette"));
  });
});
