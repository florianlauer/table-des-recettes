import { toSearchTokens } from './normalize'

export function findMatchingIngredient(
  title: string,
  ingredients: readonly { raw: string }[],
  queryTokens: string,
): string | null {
  const terms = queryTokens.split(' ').filter(Boolean)
  if (terms.length === 0) return null

  // Only look for a reason among the terms the title does not already explain. Testing
  // "does the title cover ALL terms?" and then falling back to the full list returned
  // "4 courgettes" for the query "courgette ail" on "Tian de courgettes": the line of the
  // one term that needed no explanation, with the garlic hidden.
  const titleTokens = toSearchTokens(title).split(' ')
  const unexplained = terms.filter((term) => !titleTokens.includes(term))
  if (unexplained.length === 0) return null

  for (const ingredient of ingredients) {
    const tokens = toSearchTokens(ingredient.raw).split(' ')
    if (unexplained.some((term) => tokens.includes(term))) return ingredient.raw
  }
  return null
}
