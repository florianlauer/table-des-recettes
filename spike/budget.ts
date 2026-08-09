import { readFile, writeFile } from "node:fs/promises";

// OpenRouter facture en USD : plafond et réserve restent donc dans cette devise unique.
export const BUDGET_CAP_USD = 5;
export const PROBE_RESERVE_USD = 0.25;

export class BudgetExceededError extends Error {
  constructor({ spent, maximumNext, cap }: { spent: number; maximumNext: number; cap: number }) {
    super(
      `Appel refusé : ${spent.toFixed(6)} USD dépensés + ${maximumNext.toFixed(6)} USD au pire cas > plafond ${cap.toFixed(2)} USD.`,
    );
    this.name = "BudgetExceededError";
  }
}

export class BudgetCounter {
  #spent: number;
  readonly cap: number;

  constructor({ spent = 0, cap = BUDGET_CAP_USD }: { spent?: number; cap?: number } = {}) {
    this.#spent = spent;
    this.cap = cap;
  }

  get spent(): number {
    return this.#spent;
  }

  assertCanSpend(maximumNext: number): void {
    if (this.#spent + maximumNext > this.cap) {
      throw new BudgetExceededError({ spent: this.#spent, maximumNext, cap: this.cap });
    }
  }

  assertCanProbe(): void {
    this.assertCanSpend(PROBE_RESERVE_USD);
  }

  record(actualCost: number): void {
    if (!Number.isFinite(actualCost) || actualCost < 0) {
      throw new Error(`Coût réel invalide : ${actualCost}.`);
    }
    this.#spent += actualCost;
  }

  static async load({ path, cap = BUDGET_CAP_USD }: { path: string; cap?: number }): Promise<BudgetCounter> {
    try {
      const persisted = JSON.parse(await readFile(path, "utf8")) as { spentUsd?: unknown };
      if (typeof persisted.spentUsd !== "number") {
        throw new Error("spentUsd absent ou invalide");
      }
      return new BudgetCounter({ spent: persisted.spentUsd, cap });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new BudgetCounter({ cap });
      }
      throw new Error(`Compteur de budget illisible (${path}) : ${String(error)}`);
    }
  }

  async save(path: string): Promise<void> {
    await writeFile(path, `${JSON.stringify({ currency: "USD", spentUsd: this.#spent }, null, 2)}\n`);
  }
}
