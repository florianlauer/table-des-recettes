import { describe, expect, test } from "vitest";
import { groupByLetter, initialLetter } from "./groupByLetter";

describe("initialLetter", () => {
  test("majuscule de la première lettre normalisée", () => {
    expect(initialLetter("crêpes")).toBe("C");
  });

  test("les accents ne créent pas de groupe séparé", () => {
    expect(initialLetter("Éclairs")).toBe("E");
  });

  test("les ligatures non plus", () => {
    expect(initialLetter("Œufs mimosa")).toBe("O");
  });

  test("un titre commençant par un chiffre tombe dans #", () => {
    expect(initialLetter("4 saisons")).toBe("#");
  });
});

describe("groupByLetter", () => {
  test("liste vide", () => {
    expect(groupByLetter([])).toEqual([]);
  });

  test("trie et regroupe", () => {
    const result = groupByLetter([
      { title: "Gratin dauphinois" },
      { title: "Clafoutis aux cerises" },
      { title: "Crêpes de sarrasin" },
    ]);
    expect(result).toEqual([
      {
        letter: "C",
        items: [{ title: "Clafoutis aux cerises" }, { title: "Crêpes de sarrasin" }],
      },
      { letter: "G", items: [{ title: "Gratin dauphinois" }] },
    ]);
  });

  test("un groupe d'un seul élément est un groupe valide", () => {
    const result = groupByLetter([{ title: "Tartiflette" }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.letter).toBe("T");
  });
});
