/**
 * French agreement: only two and above take the plural — « 0 recette », « 1 recette »,
 * « 2 recettes ». The « (s) » the admin printed everywhere is the note of a job left undone; the
 * code holds the number, so it can choose the word.
 */
export function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count >= 2 ? plural : singular}`
}
