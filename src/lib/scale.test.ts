import { describe, expect, test } from "vitest";
import { formatQuantity, scaleIngredient, scaleQuantity, servingsFactor } from "./scale";

describe("servingsFactor", () => {
  test("target over original", () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
  });

  test("a zero or negative original neutralises the factor", () => {
    expect(servingsFactor(0, 6)).toBe(1);
  });
});

describe("scaleQuantity without a unit (countable)", () => {
  test("rounds to a whole number", () => {
    expect(scaleQuantity(3, 1.5, false)).toBe(5);
  });

  test("never drops below 1", () => {
    expect(scaleQuantity(1, 0.25, false)).toBe(1);
  });
});

describe("scaleQuantity with a unit", () => {
  test("above 10, rounds to a whole number", () => {
    expect(scaleQuantity(200, 1.5, true)).toBe(300);
  });

  test("from 1 to 10, rounds to the half", () => {
    expect(scaleQuantity(3, 1.5, true)).toBe(4.5);
  });

  test("below 1, rounds to the quarter", () => {
    expect(scaleQuantity(1, 0.25, true)).toBe(0.25);
    expect(scaleQuantity(1, 0.4, true)).toBe(0.5);
  });

  test("never drops below 0.25", () => {
    expect(scaleQuantity(1, 0.01, true)).toBe(0.25);
  });
});

describe("formatQuantity", () => {
  test("a whole number stays whole", () => {
    expect(formatQuantity(300)).toBe("300");
  });

  test("a half uses the French decimal comma", () => {
    expect(formatQuantity(4.5)).toBe("4,5");
  });

  test("a quarter keeps its two decimals", () => {
    expect(formatQuantity(0.25)).toBe("0,25");
  });

  test("a half does not trail a zero", () => {
    expect(formatQuantity(0.5)).toBe("0,5");
  });
});

describe("scaleQuantity — boundaries", () => {
  test("exactly 10 stays on the half, above 10 switches to whole numbers", () => {
    expect(scaleQuantity(10, 1, true)).toBe(10);
    // The threshold is "above 10", not "above 10.5": from 10.4 on we round to a whole
    // number. That is the plan's global constraint, and the only step without halves.
    expect(scaleQuantity(10.4, 1, true)).toBe(10);
    expect(scaleQuantity(10.5, 1, true)).toBe(11);
    expect(scaleQuantity(10.6, 1, true)).toBe(11);
  });

  test("exactly 1 is on the half, just below is on the quarter", () => {
    expect(scaleQuantity(1, 1, true)).toBe(1);
    expect(scaleQuantity(0.9, 1, true)).toBe(1);
    expect(scaleQuantity(0.6, 1, true)).toBe(0.5);
  });
});

describe("numeric guards", () => {
  test("a non-finite factor or quantity recalculates nothing", () => {
    expect(scaleIngredient({ raw: "200 g", quantity: 200, unit: "g" }, NaN).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: NaN, unit: "g" }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "200 g", quantity: -5, unit: "g" }, 2).scaled).toBe(false);
  });

  test("servingsFactor neutralises absurd inputs", () => {
    expect(servingsFactor(0, 6)).toBe(1);
    expect(servingsFactor(4, 0)).toBe(1);
    expect(servingsFactor(NaN, 6)).toBe(1);
  });
});

describe("scaleIngredient", () => {
  test("substitutes the number inside the raw line", () => {
    const result = scaleIngredient({ raw: "200 g de farine", quantity: 200, unit: "g" }, 1.5);
    expect(result).toEqual({ text: "300 g de farine", scaled: true });
  });

  test("a line without a quantity is left untouched", () => {
    const result = scaleIngredient({ raw: "2 à 3 gousses d'ail" }, 2);
    expect(result).toEqual({ text: "2 à 3 gousses d'ail", scaled: false });
  });

  test("handles a decimal written the French way", () => {
    const result = scaleIngredient({ raw: "1,5 L de lait", quantity: 1.5, unit: "L" }, 2);
    expect(result).toEqual({ text: "3 L de lait", scaled: true });
  });

  test("countable, no unit", () => {
    const result = scaleIngredient({ raw: "3 œufs", quantity: 3 }, 2);
    expect(result).toEqual({ text: "6 œufs", scaled: true });
  });

  test("no agreement: below two, the trailing text is reproduced verbatim", () => {
    // Deliberate. Automatic agreement was removed: it required lexicons of invariables,
    // irregulars, prenominal adjectives and elided forms, and it produced a fresh defect
    // at every one of the plan's five reviews. "1 gousses" is readable; "1 gro œufs" was
    // not. This test locks the absence of any rule.
    expect(scaleIngredient({ raw: "3 œufs", quantity: 3 }, 1 / 3).text).toBe("1 œufs");
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 0.5).text).toBe(
      "1 gousses d'ail",
    );
    expect(scaleIngredient({ raw: "3 gros œufs", quantity: 3 }, 1 / 3).text).toBe("1 gros œufs");
    expect(scaleIngredient({ raw: "3 beaux œufs", quantity: 3 }, 1 / 3).text).toBe(
      "1 beaux œufs",
    );
  });

  test("an invariable word is never truncated", () => {
    expect(scaleIngredient({ raw: "4 noix", quantity: 4 }, 0.25).text).toBe("1 noix");
    expect(scaleIngredient({ raw: "3 os à moelle", quantity: 3 }, 1 / 3).text).toBe(
      "1 os à moelle",
    );
  });

  test("an abbreviated unit is left alone", () => {
    expect(
      scaleIngredient({ raw: "4 c. à soupe de crème", quantity: 4, unit: "c. à soupe" }, 0.25)
        .text,
    ).toBe("1 c. à soupe de crème");
  });

  test("above two, the plural is kept", () => {
    expect(scaleIngredient({ raw: "2 gousses d'ail", quantity: 2 }, 2).text).toBe(
      "4 gousses d'ail",
    );
  });

  test("quantity annotated but no number in the raw line", () => {
    const result = scaleIngredient({ raw: "une pincée de sel", quantity: 1 }, 3);
    expect(result).toEqual({ text: "une pincée de sel", scaled: false });
  });

  test("the first number must match the annotation, otherwise nothing is touched", () => {
    // "2 à 3 gousses" annotated 3: replacing the 2 would produce "6 à 3 gousses".
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 3 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    // Annotated on the LOWER bound: the number matches, and yet it must not be touched.
    expect(scaleIngredient({ raw: "2 à 3 gousses d'ail", quantity: 2 }, 2)).toEqual({
      text: "2 à 3 gousses d'ail",
      scaled: false,
    });
    expect(scaleIngredient({ raw: "1 1/2 tasse de farine", quantity: 1 }, 2).scaled).toBe(false);
    expect(scaleIngredient({ raw: "2-3 échalotes", quantity: 2 }, 2).scaled).toBe(false);
    // "200 g de chocolat à 70 %" annotated 70: the first number is 200, not 70.
    expect(
      scaleIngredient({ raw: "200 g de chocolat à 70 %", quantity: 70, unit: "%" }, 2).scaled,
    ).toBe(false);
  });

  test("the seed data's -aux plural is not mutilated", () => {
    // The historical risk was "poireaux" becoming "poireal". Without agreement the
    // question no longer arises: the word is never touched.
    expect(scaleIngredient({ raw: "6 poireaux", quantity: 6 }, 1 / 6).text).toBe("1 poireaux");
  });

  test("a factor of 1 returns the raw line character for character", () => {
    expect(scaleIngredient({ raw: "200 g de farine", quantity: 200, unit: "g" }, 1).text).toBe(
      "200 g de farine",
    );
    // The trap that only the `factor === 1` short-circuit avoids: reformatting the number.
    expect(scaleIngredient({ raw: "1,50 L d'eau", quantity: 1.5, unit: "L" }, 1).text).toBe(
      "1,50 L d'eau",
    );
  });
});
