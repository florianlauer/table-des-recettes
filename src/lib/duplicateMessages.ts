/**
 * Names the twin, and says where it is. The distinction is the whole message: a published twin is
 * already on the storefront, so publishing this one puts a second copy there — while a twin in
 * review only means the page was scanned twice and one of the two drafts is surplus.
 *
 * Structurally typed rather than importing the query's return type: `src/lib` may not reach into
 * `convex/_generated`, and the caller passes `recipe.duplicateOf`, which the router already types by
 * inference.
 */
export function duplicateNote({
  title,
  status,
}: {
  title: string
  status: 'review' | 'published'
}): string {
  return status === 'published'
    ? `« ${title} » est déjà en ligne sous ce titre.`
    : `« ${title} » porte déjà ce titre et attend en relecture.`
}

// A dialog is truncated by the browser well before fifty titles, and the list is the only reason the
// dialog exists — so it is cut here, where the count can still be stated.
const NAMED_IN_DIALOG = 8

/**
 * Asked before « Tout publier ». Without it the one path that publishes in bulk would push every
 * duplicate online without the warning ever being read: the notice sits on each recipe, and the
 * button is at the top of the page.
 *
 * The titles are the **drafts'**, not their twins' — « de ce scan » says so — because these are the
 * rows the operator has to find and delete below.
 */
export function bulkDuplicateConfirm(titles: readonly string[]): string {
  // The count is of rows and the list is of names, and the two legitimately differ: three drafts of
  // one page are three duplicates under one title, and repeating that title three times reads as a
  // rendering fault — besides spending the whole naming budget on it.
  //
  // No « sans titre » fallback: a draft only carries a duplicate when its `titleKey` is non-empty,
  // and that key is the folded title — so every title reaching this list has letters in it.
  const distinct = [...new Set(titles)]
  const named = distinct.slice(0, NAMED_IN_DIALOG)
  const rest = distinct.length - named.length
  const names = named.join(' · ')
  const list = rest > 0 ? `${names} — et ${rest} de plus` : names
  const head =
    titles.length === 1
      ? 'Une recette de ce scan porte un titre déjà scanné'
      : `${titles.length} recettes de ce scan portent un titre déjà scanné`
  return `${head} : ${list}. Tout publier quand même ?`
}
