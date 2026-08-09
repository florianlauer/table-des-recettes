import { describe, expect, test } from "vitest";
import { buildSearchText, normalizeText, stemToken, toSearchTokens } from "./normalize";

describe("normalizeText", () => {
  test("strips accents", () => {
    expect(normalizeText("Crêpes de sarrasin")).toBe("crepes de sarrasin");
  });

  test("expands ligatures", () => {
    expect(normalizeText("Œufs à la coque")).toBe("oeufs a la coque");
  });

  test("collapses punctuation and repeated spaces", () => {
    expect(normalizeText("Tarte  fine, aux poireaux !")).toBe("tarte fine aux poireaux");
  });

  test("empty string", () => {
    expect(normalizeText("   ")).toBe("");
  });
});

describe("stemToken", () => {
  test("strips the plural from words longer than three letters", () => {
    expect(stemToken("courgettes")).toBe("courgette");
    expect(stemToken("choux")).toBe("chou");
  });

  test("leaves short words untouched", () => {
    expect(stemToken("aux")).toBe("aux");
    expect(stemToken("des")).toBe("des");
  });
});

describe("toSearchTokens", () => {
  test("singular and plural produce the same token", () => {
    expect(toSearchTokens("Courgettes")).toBe(toSearchTokens("courgette"));
  });
});

describe("buildSearchText", () => {
  test("concatenates the title and the raw lines", () => {
    const result = buildSearchText("Riz au lait", [{ raw: "200 g de riz rond" }]);
    expect(result).toContain("riz");
    expect(result).toContain("rond");
  });

  test("an ingredient becomes searchable in both plural and singular", () => {
    const result = buildSearchText("Gratin", [{ raw: "3 courgettes" }]);
    expect(result.split(" ")).toContain(toSearchTokens("courgette"));
  });
});
