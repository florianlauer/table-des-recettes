import { formatCount } from './formatCount'
import { TYPE_FILTER_LABELS } from './recipeTypes'
import type { RecipeType } from './recipeTypes'

/**
 * The one line that says what the index is restricted to, and what the restriction produced.
 *
 * It was two functions — a count line and an empty line — and the fact that they share a slot was
 * expressed as a conditional in the route. They are the same sentence with a different verb: same
 * four-way branch on (query, filter), same quoting rule, and « no result » is just the zero case.
 *
 * The filter is quoted by the label its button shows rather than declined into the sentence:
 * « apéro » and « petits-déjeuners » do not agree the same way, and a half-correct rule reads worse
 * than a quotation. Naming the restriction matters most when the list is empty — a type filter
 * picked three scrolls up is off screen by then.
 *
 * `null` when nothing restricts the index: there is no restriction to name, and the masthead already
 * says how many recipes there are.
 */
export function indexStatusLine({
  count,
  query,
  type,
}: {
  count: number
  query?: string
  type?: RecipeType
}): string | null {
  const trimmed = query?.trim()
  const filter = type ? TYPE_FILTER_LABELS[type] : null
  if (!trimmed && !filter) return null

  if (count === 0) {
    if (trimmed && filter)
      return `Aucune recette ne correspond à « ${trimmed} » dans « ${filter} ».`
    if (trimmed) return `Aucune recette ne correspond à « ${trimmed} ».`
    return `Aucune recette dans « ${filter} ».`
  }

  const results = formatCount(count, 'résultat')
  if (trimmed && filter)
    return `${results} pour « ${trimmed} » dans « ${filter} »`
  if (trimmed) return `${results} pour « ${trimmed} »`
  return `${results} dans « ${filter} »`
}
