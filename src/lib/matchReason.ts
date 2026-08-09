import { toSearchTokens } from "./normalize";

export function findMatchingIngredient(
  title: string,
  ingredients: readonly { raw: string }[],
  queryTokens: string,
): string | null {
  const terms = queryTokens.split(" ").filter(Boolean);
  if (terms.length === 0) return null;

  // Ne chercher une raison que pour ce que le titre n'explique pas déjà. Tester
  // « le titre couvre-t-il TOUS les termes ? » puis repartir de la liste complète
  // faisait rendre « 4 courgettes » sur « courgette ail » pour « Tian de courgettes » :
  // la ligne du seul terme qui n'avait pas besoin d'explication, et l'ail masqué.
  const titleTokens = toSearchTokens(title).split(" ");
  const unexplained = terms.filter((term) => !titleTokens.includes(term));
  if (unexplained.length === 0) return null;

  for (const ingredient of ingredients) {
    const tokens = toSearchTokens(ingredient.raw).split(" ");
    if (unexplained.some((term) => tokens.includes(term))) return ingredient.raw;
  }
  return null;
}
