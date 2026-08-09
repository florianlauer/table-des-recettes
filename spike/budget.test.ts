import { describe, expect, it } from "vitest";

import { BudgetCounter, BudgetExceededError } from "./budget.js";

describe("pré-vérification du budget", () => {
  it("refuse avant l'appel quand spent + max_next dépasse le plafond", () => {
    const budget = new BudgetCounter({ spent: 4.8, cap: 5 });
    expect(() => budget.assertCanSpend(0.21)).toThrow(BudgetExceededError);
  });

  it("autorise un total juste sous le plafond", () => {
    const budget = new BudgetCounter({ spent: 4.8, cap: 5 });
    expect(() => budget.assertCanSpend(0.199999)).not.toThrow();
  });

  it("refuse une sonde quand spent + 0.25 dépasse le plafond", () => {
    const budget = new BudgetCounter({ spent: 4.751, cap: 5 });
    expect(() => budget.assertCanProbe()).toThrow(BudgetExceededError);
  });
});
