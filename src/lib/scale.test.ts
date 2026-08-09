import { describe, expect, test } from "vitest";
import {
  formatQuantity,
  scaleIngredient,
  scaleQuantity,
  servingsFactor,
  singularize,
} from "./scale";

describe("servingsFactor", () => {
  test("rapport cible sur origine", () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
  });

  test("origine nulle ou négative neutralise le facteur", () => {
    expect(servingsFactor(0, 6)).toBe(1);
  });
});

describe("scaleQuantity sans unité (dénombrable)", () => {
  test("arrondit à l'entier", () => {
    expect(scaleQuantity(3, 1.5, false)).toBe(5);
  });

  test("ne descend jamais sous 1", () => {
    expect(scaleQuantity(1, 0.25, false)).toBe(1);
  });
});

describe("scaleQuantity avec unité", () => {
  test("au-delà de 10, arrondi à l'entier", () => {
    expect(scaleQuantity(200, 1.5, true)).toBe(300);
  });

  test("de 1 à 10, arrondi au demi", () => {
    expect(scaleQuantity(3, 1.5, true)).toBe(4.5);
  });

  test("sous 1, arrondi au quart", () => {
    expect(scaleQuantity(1, 0.25, true)).toBe(0.25);
    expect(scaleQuantity(1, 0.4, true)).toBe(0.5);
  });

  test("ne descend jamais sous 0,25", () => {
    expect(scaleQuantity(1, 0.01, true)).toBe(0.25);
  });
});

describe("formatQuantity", () => {
  test("un entier reste entier", () => {
    expect(formatQuantity(300)).toBe("300");
  });

  test("un demi utilise la virgule française", () => {
    expect(formatQuantity(4.5)).toBe("4,5");
  });

  test("un quart garde ses deux décimales", () => {
    expect(formatQuantity(0.25)).toBe("0,25");
  });

  test("un demi ne traîne pas de zéro", () => {
    expect(formatQuantity(0.5)).toBe("0,5");
  });
});

describe("singularize", () => {
  test("retire le pluriel régulier", () => {
    expect(singularize("œufs")).toBe("œuf");
    expect(singularize("gousses")).toBe("gousse");
    expect(singularize("choux")).toBe("chou");
  });

  test("les pluriels en -aux réguliers gardent leur radical", () => {
    expect(singularize("poireaux")).toBe("poireau");
    expect(singularize("noyaux")).toBe("noyau");
    expect(singularize("pruneaux")).toBe("pruneau");
  });

  test("protège les invariables français", () => {
    expect(singularize("noix")).toBe("noix");
    expect(singularize("pois")).toBe("pois");
    expect(singularize("ananas")).toBe("ananas");
    expect(singularize("maïs")).toBe("maïs");
    expect(singularize("couscous")).toBe("couscous");
    expect(singularize("houmous")).toBe("houmous");
  });

  test("les mots de trois lettres ou moins sont déjà protégés", () => {
    expect(singularize("os")).toBe("os");
    expect(singularize("riz")).toBe("riz");
    expect(singularize("jus")).toBe("jus");
  });

  test("le seul irrégulier déclaré", () => {
    expect(singularize("bocaux")).toBe("bocal");
  });
});

describe("scaleQuantity — frontières", () => {
  test("exactement 10 reste au demi, au-dessus de 10 on passe à l'entier", () => {
    expect(scaleQuantity(10, 1, true)).toBe(10);
    // Le palier est « au-dessus de 10 », pas « au-dessus de 10,5 » : dès 10,4 on arrondit
    // à l'entier. C'est la contrainte globale du plan, et le seul palier sans demi.
    expect(scaleQuantity(10.4, 1, true)).toBe(10);
    expect(scaleQuantity(10.5, 1, true)).toBe(11);
    expect(scaleQuantity(10.6, 1, true)).toBe(11);
  });

  test("exactement 1 est au demi, juste en dessous est au quart", () => {
    expect(scaleQuantity(1, 1, true)).toBe(1);
    expect(scaleQuantity(0.9, 1, true)).toBe(1);
    expect(scaleQuantity(0.6, 1, true)).toBe(0.5);
  });
});

describe("gardes numériques", () => {
  test("un facteur ou une quantité non finie ne recalcule rien", () => {
    expect(scaleIngredient({ raw: "200 g", quantity: 200, unit: "g" }, NaN).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: NaN, unit: "g" }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: -5, unit: "g" }, 2).scaled).toBe(false);
  });

  test("servingsFactor neutralise les entrées absurdes", () => {
    expect(servingsFactor(0, 6)).toBe(1);
    expect(servingsFactor(4, 0)).toBe(1);
    expect(servingsFactor(NaN, 6)).toBe(1);
  });
});

describe("scaleIngredient", () => {
  test("substitue le nombre dans la ligne brute", () => {
    const result = scaleIngredient(
      { raw: "200 g de farine", quantity: 200, unit: "g" },
      1.5,
    );
    expect(result).toEqual({ text: "300 g de farine", scaled: true });
  });

  test("une ligne sans quantity est laissée intacte", () => {
    const result = scaleIngredient({ raw: "2 à 3 gousses d'ail" }, 2);
    expect(result).toEqual({ text: "2 à 3 gousses d'ail", scaled: false });
  });

  test("gère un nombre décimal écrit à la française", () => {
    const result = scaleIngredient(
      { raw: "1,5 L de lait", quantity: 1.5, unit: "L" },
      2,
    );
    expect(result).toEqual({ text: "3 L de lait", scaled: true });
  });

  test("dénombrable sans unité", () => {
    const result = scaleIngredient({ raw: "3 œufs", quantity: 3 }, 2);
    expect(result).toEqual({ text: "6 œufs", scaled: true });
  });

  test("sous deux, le mot qui suit passe au singulier", () => {
    expect(scaleIngredient({ raw: "3 œufs", quantity: 3 }, 1 / 3).text).toBe("1 œuf");
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 0.5).text).toBe(
      "1 gousse d'ail",
    );
  });

  test("un invariable n'est jamais amputé", () => {
    expect(scaleIngredient({ raw: "4 noix", quantity: 4 }, 0.25).text).toBe("1 noix");
    expect(scaleIngredient({ raw: "3 os à moelle", quantity: 3 }, 1 / 3).text).toBe(
      "1 os à moelle",
    );
  });

  test("une unité abrégée n'est pas touchée", () => {
    expect(
      scaleIngredient({ raw: "4 c. à soupe de crème", quantity: 4, unit: "c. à soupe" }, 0.25)
        .text,
    ).toBe("1 c. à soupe de crème");
  });

  test("au-dessus de deux, le pluriel est conservé", () => {
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 2).text).toBe(
      "4 gousses d'ail",
    );
  });

  test("quantity annotée mais aucun nombre dans la ligne brute", () => {
    const result = scaleIngredient({ raw: "une pincée de sel", quantity: 1 }, 3);
    expect(result).toEqual({ text: "une pincée de sel", scaled: false });
  });

  test("le premier nombre doit correspondre à l'annotation, sinon on ne touche à rien", () => {
    // « 2 à 3 gousses » annoté 3 : remplacer le 2 fabriquerait « 6 à 3 gousses ».
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 3 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    // Annoté sur la borne BASSE : le nombre correspond, et pourtant il ne faut pas y toucher.
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 2 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    expect(scaleIngredient({ raw: "1 1/2 tasse de farine", quantity: 1 }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "2-3 échalotes", quantity: 2 }, 2).scaled).toBe(false);
    // « 200 g de chocolat à 70 % » annoté 70 : le premier nombre est 200, pas 70.
    expect(
      scaleIngredient({ raw: "200 g de chocolat à 70 %", quantity: 70, unit: "%" }, 2).scaled,
    ).toBe(false);
  });

  test("le pluriel en -aux du jeu de seed survit au recalcul", () => {
    expect(scaleIngredient({ raw: "6 poireaux", quantity: 6 }, 1 / 6).text).toBe("1 poireau");
  });

  test("facteur 1 rend la ligne brute au caractère près", () => {
    expect(scaleIngredient({ raw: "200 g de farine", quantity: 200, unit: "g" }, 1).text).toBe(
      "200 g de farine",
    );
    // Deux pièges que seul le court-circuit `factor === 1` évite : le reformatage du
    // nombre, et l'accord d'une ligne déjà sous deux alors que rien n'a bougé.
    expect(scaleIngredient({ raw: "1,50 L d'eau", quantity: 1.5, unit: "L" }, 1).text).toBe(
      "1,50 L d'eau",
    );
    expect(scaleIngredient({ raw: "1 gousses d'ail", quantity: 1 }, 1).text).toBe(
      "1 gousses d'ail",
    );
  });

  test("l'adjectif antéposé s'accorde avec le nom, et rien au-delà", () => {
    expect(scaleIngredient({ raw: "3 gros œufs", quantity: 3 }, 1 / 3).text).toBe("1 gros œuf");
    expect(scaleIngredient({ raw: "4 petits oignons", quantity: 4 }, 0.25).text).toBe(
      "1 petit oignon",
    );
    // Le mot suivant le nom n'est jamais touché : « poireaux » reste au pluriel.
    expect(scaleIngredient({ raw: "2 tartes aux poireaux", quantity: 2 }, 0.5).text).toBe(
      "1 tarte aux poireaux",
    );
  });

  test("beau, nouveau et vieux prennent leur forme devant voyelle", () => {
    expect(scaleIngredient({ raw: "3 beaux œufs", quantity: 3 }, 1 / 3).text).toBe("1 bel œuf");
    expect(scaleIngredient({ raw: "2 vieux oignons", quantity: 2 }, 0.5).text).toBe(
      "1 vieil oignon",
    );
    // Devant consonne, la forme de base : « un beau chou », pas « un bel chou ».
    expect(scaleIngredient({ raw: "2 beaux choux", quantity: 2 }, 0.5).text).toBe("1 beau chou");
    // `h` aspiré : « haricot » se comporte comme une consonne.
    expect(scaleIngredient({ raw: "4 beaux haricots", quantity: 4 }, 0.25).text).toBe(
      "1 beau haricot",
    );
  });
});
