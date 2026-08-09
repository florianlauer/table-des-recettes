import { buildSearchText } from "../../src/lib/normalize";

/**
 * Seul point d'entrée autorisé pour écrire le couple (titre, ingrédients).
 * Dérive systématiquement `searchText` : jamais d'insert ni de patch sans passer par ici.
 */
export function withSearchText<
  T extends { title: string; ingredients: readonly { raw: string }[] },
>(fields: T): T & { searchText: string } {
  return { ...fields, searchText: buildSearchText(fields.title, fields.ingredients) };
}
