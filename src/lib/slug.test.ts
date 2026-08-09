import { describe, expect, test } from "vitest";
import { resolveSlugCollision, slugify } from "./slug";

describe("slugify", () => {
  test("lowercases and joins with hyphens", () => {
    expect(slugify("Crêpes de sarrasin")).toBe("crepes-de-sarrasin");
  });

  test("expands ligatures", () => {
    expect(slugify("Œufs à la coque")).toBe("oeufs-a-la-coque");
  });

  test("absorbs punctuation", () => {
    expect(slugify("Poulet basquaise, façon express !")).toBe("poulet-basquaise-facon-express");
  });

  test("title with no usable character", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("resolveSlugCollision", () => {
  test("returns the base when it is free", () => {
    expect(resolveSlugCollision("tarte", [])).toBe("tarte");
  });

  test("suffixes from 2 onwards", () => {
    expect(resolveSlugCollision("tarte", ["tarte"])).toBe("tarte-2");
  });

  test("skips suffixes already taken", () => {
    expect(resolveSlugCollision("tarte", ["tarte", "tarte-2", "tarte-3"])).toBe("tarte-4");
  });

  test("ignores unrelated slugs", () => {
    expect(resolveSlugCollision("tarte", ["gratin", "gratin-2"])).toBe("tarte");
  });
});
