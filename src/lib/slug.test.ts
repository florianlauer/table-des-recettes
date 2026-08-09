import { describe, expect, test } from "vitest";
import { resolveSlugCollision, slugify } from "./slug";

describe("slugify", () => {
  test("met en minuscules et relie par des tirets", () => {
    expect(slugify("Crêpes de sarrasin")).toBe("crepes-de-sarrasin");
  });

  test("décompose les ligatures", () => {
    expect(slugify("Œufs à la coque")).toBe("oeufs-a-la-coque");
  });

  test("absorbe la ponctuation", () => {
    expect(slugify("Poulet basquaise, façon express !")).toBe("poulet-basquaise-facon-express");
  });

  test("titre sans caractère exploitable", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("resolveSlugCollision", () => {
  test("renvoie la base quand elle est libre", () => {
    expect(resolveSlugCollision("tarte", [])).toBe("tarte");
  });

  test("suffixe à partir de 2", () => {
    expect(resolveSlugCollision("tarte", ["tarte"])).toBe("tarte-2");
  });

  test("saute les suffixes déjà pris", () => {
    expect(resolveSlugCollision("tarte", ["tarte", "tarte-2", "tarte-3"])).toBe("tarte-4");
  });

  test("ignore les slugs sans rapport", () => {
    expect(resolveSlugCollision("tarte", ["gratin", "gratin-2"])).toBe("tarte");
  });
});
