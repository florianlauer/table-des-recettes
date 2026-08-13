import { TYPE_FILTER_LABELS } from './recipeTypes'
import type { RecipeType } from './recipeTypes'

/**
 * Names the restriction that emptied the index. « Aucune recette ne correspond » left the reader to
 * work out which of the two filters was to blame — and a type filter picked three scrolls up is off
 * screen by the time the list is empty.
 *
 * The filter is quoted by the label the button shows rather than declined into the sentence: « apéro »
 * and « petits-déjeuners » do not agree the same way, and a half-correct rule reads worse than a
 * quotation.
 */
export function emptyIndexLine({
  query,
  type,
}: {
  query?: string
  type?: RecipeType
}): string {
  const trimmed = query?.trim()
  const filter = type ? TYPE_FILTER_LABELS[type] : null

  if (trimmed && filter)
    return `Aucune recette ne correspond à « ${trimmed} » dans « ${filter} ».`
  if (trimmed) return `Aucune recette ne correspond à « ${trimmed} ».`
  if (filter) return `Aucune recette dans « ${filter} ».`
  return 'Aucune recette ne correspond.'
}
