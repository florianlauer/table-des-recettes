import { buildSearchText } from "../../src/lib/normalize";

/**
 * The only authorised entry point for writing the (title, ingredients) pair.
 * Always derives `searchText`: never insert or patch without going through here.
 */
export function withSearchText<
  T extends { title: string; ingredients: readonly { raw: string }[] },
>(fields: T): T & { searchText: string } {
  return { ...fields, searchText: buildSearchText(fields.title, fields.ingredients) };
}
