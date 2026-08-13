export const RECIPE_STATUSES = ['review', 'published'] as const

export type RecipeStatus = (typeof RECIPE_STATUSES)[number]

/** Opening a line of its own, on the correction screen. */
export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  review: 'Brouillon',
  published: 'Publiée',
}

/**
 * Inline, after another fact: "Entrée · publiée". Same shape as `scanStatusLabel` — the state stays
 * on the line, as data, in French. DESIGN.md exempts `/admin` from Fraunces, from the fluid type
 * scale and from the type inks; nothing there exempts it from the language of the product.
 */
export function recipeStatusLabel(status: RecipeStatus): string {
  return RECIPE_STATUS_LABELS[status].toLocaleLowerCase('fr')
}
