import { formatCount } from './formatCount'
import { TYPE_FILTER_LABELS } from './recipeTypes'
import type { RecipeType } from './recipeTypes'

/**
 * The line that names the restriction the index is under, and the count it produced. It used to be
 * read only by assistive technology: the sighted reader got a list that had silently changed regime
 * and no sentence saying so.
 *
 * Same quoting rule as `emptyIndexLine`, and for the same reason: the filter is quoted by the label
 * its button shows rather than declined into the sentence.
 *
 * Returns `null` when nothing restricts the index — there is then no restriction to name, and the
 * shelf count in the masthead already says how many recipes there are.
 */
export function searchStatusLine({
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

  const results = formatCount(count, 'résultat')
  if (trimmed && filter)
    return `${results} pour « ${trimmed} » dans « ${filter} »`
  if (trimmed) return `${results} pour « ${trimmed} »`
  return `${results} dans « ${filter} »`
}
