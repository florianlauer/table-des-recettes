import { describe, expect, it } from "vitest";

import { BudgetCounter, BudgetExceededError } from "./budget.js";

describe("budget pre-check", () => {
  it("refuses before the call when spent + max_next exceeds the cap", () => {
    const budget = new BudgetCounter({ spent: 4.8, cap: 5 });
    expect(() => budget.assertCanSpend(0.21)).toThrow(BudgetExceededError);
  });

  it("allows a total just under the cap", () => {
    const budget = new BudgetCounter({ spent: 4.8, cap: 5 });
    expect(() => budget.assertCanSpend(0.199999)).not.toThrow();
  });

  it("refuses a probe when spent + 0.25 exceeds the cap", () => {
    const budget = new BudgetCounter({ spent: 4.751, cap: 5 });
    expect(() => budget.assertCanProbe()).toThrow(BudgetExceededError);
  });
});
