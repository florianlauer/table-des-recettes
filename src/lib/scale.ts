export type Ingredient = {
  raw: string
  quantity?: number
  unit?: string
  label?: string
}

const NUMBER_IN_RAW = /\d+(?:[.,]\d+)?/
// "2 à 3 gousses", "2-3 gousses", "1 1/2 tasse": the number found is not alone. Two
// distinct shapes: the separator immediately follows the number (`à 3`, `-3`), or it is a
// mixed number and the separator only comes after the NEXT one (`1 1/2`). Keeping only the
// first shape let "1 1/2 tasse" double into "2 1/2 tasse".
const RANGE_OR_FRACTION = /^\s*(?:(?:à|a|-|–|\/)\s*\d|\d+\s*\/\s*\d)/i

export function servingsFactor(original: number, target: number): number {
  if (!Number.isFinite(original) || !Number.isFinite(target)) return 1
  if (original <= 0 || target <= 0) return 1
  return target / original
}

export function scaleQuantity(
  quantity: number,
  factor: number,
  hasUnit: boolean,
): number {
  const value = quantity * factor
  if (!hasUnit) return Math.max(1, Math.round(value))
  if (value > 10) return Math.round(value)
  if (value >= 1) return Math.round(value * 2) / 2
  return Math.max(0.25, Math.round(value * 4) / 4)
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/0$/, '').replace('.', ',')
}

/**
 * Recalculates the quantity and **nothing else**: the text following the number is
 * reproduced character for character, with no grammatical agreement.
 *
 * Automatic agreement existed and was then removed. It required lexicons of invariables,
 * irregular plurals, prenominal adjectives and elided forms — and it produced a fresh defect
 * at every one of the plan's five reviews ("1 gro œufs", "1 beau œuf"). The domain is deeper
 * than the need: scaling is declared *best-effort* in `CONTEXT.md`, and "1 gousses" stays
 * readable where a half-correct grammar rule fails silently. If agreement ever comes back it
 * must come from ingestion, which knows the word, not from rendering, which only sees a string.
 */
export function scaleIngredient(
  ingredient: Ingredient,
  factor: number,
): { text: string; scaled: boolean } {
  const { raw, quantity, unit } = ingredient
  const unchanged = { text: raw, scaled: false } as const

  if (quantity === undefined) return unchanged
  if (!Number.isFinite(quantity) || quantity <= 0) return unchanged
  if (!Number.isFinite(factor) || factor <= 0) return unchanged

  // Servings unchanged: the raw line is authoritative and must come back character for
  // character. Without this return, "1,50 L" would become "1,5 L". `scaled: true`: nothing failed.
  if (factor === 1) return { text: raw, scaled: true }

  const match = NUMBER_IN_RAW.exec(raw)
  if (!match) return unchanged

  // The raw line is authoritative. If the first number does not match the annotation, we do
  // not know which one to replace — "200 g de chocolat à 70 %".
  if (Number(match[0].replace(',', '.')) !== quantity) return unchanged

  // And even when it matches, it may only be the lower bound of a range or the numerator of
  // a fraction: "2 à 3 gousses" annotated 2 would become "4 à 3 gousses".
  const after = raw.slice(match.index + match[0].length)
  if (RANGE_OR_FRACTION.test(after)) return unchanged

  const value = scaleQuantity(quantity, factor, unit !== undefined)
  // Rounding can land back on the annotated quantity: one kiwi for four people is still one kiwi for
  // five. The line then shows no trace of the adjustment it did not receive, and the reader has no
  // way to tell that from a quantity that genuinely holds. Reproduced raw, and marked like the lines
  // we could not read at all.
  if (value === quantity) return unchanged

  const head = raw.slice(0, match.index)

  return { text: `${head}${formatQuantity(value)}${after}`, scaled: true }
}

/** One line as the page shows it: the text, and whether it carries the dagger. */
export type ScaledLine = { text: string; marked: boolean }

const UNSCALED_NOTE =
  'Cette quantité n’a pas pu suivre l’ajustement : la ligne est reproduite telle quelle.'

/**
 * The whole ingredient list at one serving count — the marker on each line **and** the footnote
 * that decodes it, derived from the same expression.
 *
 * They used to be two: the page computed `factor !== 1 && lines.some(line => !line.scaled)` for the
 * footnote and `factor !== 1 && !scaled` again inside the list, under a comment claiming it was
 * computed once. Nothing caught the drift, and the failure it invites is silent — a dagger printed
 * with nothing on the page explaining it. Here a marked line and a note cannot exist without each
 * other.
 *
 * `from` is the coupure's own serving count, null on the recipes that never stated one: no
 * statement means no ratio, so the list is reproduced as written.
 */
export function scaleRecipe(
  ingredients: readonly Ingredient[],
  { from, to }: { from: number | null; to: number },
): { lines: ScaledLine[]; note: string | null } {
  const factor = from ? servingsFactor(from, to) : 1
  const lines = ingredients.map((ingredient) => {
    const { text, scaled } = scaleIngredient(ingredient, factor)
    return { text, marked: factor !== 1 && !scaled }
  })
  return {
    lines,
    note: lines.some((line) => line.marked) ? UNSCALED_NOTE : null,
  }
}
