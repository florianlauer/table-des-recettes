import { toSearchTokens } from "./normalize";

export function findMatchingIngredient(
  title: string,
  ingredients: readonly { raw: string }[],
  queryTokens: string,
): string | null {
  const terms = queryTokens.split(" ").filter(Boolean);
  if (terms.length === 0) return null;

  const titleTokens = toSearchTokens(title).split(" ");
  if (terms.every((term) => titleTokens.includes(term))) return null;

  for (const ingredient of ingredients) {
    const tokens = toSearchTokens(ingredient.raw).split(" ");
    if (terms.some((term) => tokens.includes(term))) return ingredient.raw;
  }
  return null;
}
