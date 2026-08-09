export type Ingredient = {
  raw: string;
  quantity?: number;
  unit?: string;
  label?: string;
};

const NUMBER_IN_RAW = /\d+(?:[.,]\d+)?/;
// « 2 à 3 gousses », « 2-3 gousses », « 1 1/2 tasse » : le nombre trouvé n'est pas seul.
// Deux formes distinctes : le séparateur suit immédiatement le nombre (`à 3`, `-3`), ou bien
// c'est un nombre mixte et le séparateur n'arrive qu'après le nombre SUIVANT (`1 1/2`).
// Ne garder que la première laissait « 1 1/2 tasse » doubler en « 2 1/2 tasse ».
const RANGE_OR_FRACTION = /^\s*(?:(?:à|a|-|–|\/)\s*\d|\d+\s*\/\s*\d)/i;

export function servingsFactor(original: number, target: number): number {
  if (!Number.isFinite(original) || !Number.isFinite(target)) return 1;
  if (original <= 0 || target <= 0) return 1;
  return target / original;
}

export function scaleQuantity(quantity: number, factor: number, hasUnit: boolean): number {
  const value = quantity * factor;
  if (!hasUnit) return Math.max(1, Math.round(value));
  if (value > 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 2) / 2;
  return Math.max(0.25, Math.round(value * 4) / 4);
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0$/, "").replace(".", ",");
}

/**
 * Recalcule la quantité et **rien d'autre** : le texte qui suit le nombre est reproduit
 * au caractère près, sans accord.
 *
 * L'accord automatique a existé puis a été retiré. Il demandait un lexique d'invariables,
 * de pluriels irréguliers, d'adjectifs antéposés et de formes élidées — et il a produit un
 * défaut neuf à chacune des cinq relectures du plan (« 1 gro œufs », « 1 beau œuf »).
 * Le domaine est plus profond que le besoin : le recalcul est déclaré *best-effort* dans
 * `CONTEXT.md`, et « 1 gousses » reste lisible là où une règle grammaticale à demi juste
 * échoue silencieusement. Si l'accord revient un jour, il devra venir de l'ingestion, qui
 * connaît le mot, et non du rendu, qui ne voit qu'une chaîne.
 */
export function scaleIngredient(
  ingredient: Ingredient,
  factor: number,
): { text: string; scaled: boolean } {
  const { raw, quantity, unit } = ingredient;
  const unchanged = { text: raw, scaled: false } as const;

  if (quantity === undefined) return unchanged;
  if (!Number.isFinite(quantity) || quantity <= 0) return unchanged;
  if (!Number.isFinite(factor) || factor <= 0) return unchanged;

  // Portions inchangées : la ligne brute fait foi et doit ressortir au caractère près.
  // Sans ce retour, « 1,50 L » deviendrait « 1,5 L ». `scaled: true` : rien n'a échoué.
  if (factor === 1) return { text: raw, scaled: true };

  const match = NUMBER_IN_RAW.exec(raw);
  if (!match) return unchanged;

  // La ligne brute fait foi. Si le premier nombre ne correspond pas à l'annotation, on ne
  // sait pas lequel remplacer — « 200 g de chocolat à 70 % ».
  if (Number(match[0].replace(",", ".")) !== quantity) return unchanged;

  // Et même quand il correspond, il peut n'être que la borne basse d'une plage ou le
  // numérateur d'une fraction : « 2 à 3 gousses » annoté 2 deviendrait « 4 à 3 gousses ».
  const after = raw.slice(match.index + match[0].length);
  if (RANGE_OR_FRACTION.test(after)) return unchanged;

  const value = scaleQuantity(quantity, factor, unit !== undefined);
  const head = raw.slice(0, match.index);

  return { text: `${head}${formatQuantity(value)}${after}`, scaled: true };
}
