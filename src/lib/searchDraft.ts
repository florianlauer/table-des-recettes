/**
 * The two rules tying the index's search field to the URL.
 *
 * The field is driven locally and the URL follows a debounce behind — but `q` trails further than
 * the debounce: the index loader awaits Convex before the URL commits, so during that flight `q` is
 * not what the page last asked for. `pushed` is: the value handed to the last navigation, `''` when
 * there is no search. Both rules read it. Reading `q` instead cost a fast typist the letters typed
 * in flight, spent a history entry per keystroke that outran the loader, and left an erased search
 * standing in the URL.
 */

/** What an incoming `q` means for a field that last pushed `pushed`. */
export function urlChange({
  q,
  pushed,
}: {
  q: string | undefined
  pushed: string
}): { adopt: false } | { adopt: true; draft: string } {
  const incoming = q ?? ''
  if (incoming === pushed) return { adopt: false }
  return { adopt: true, draft: incoming }
}

/** What a draft that has stopped changing owes the URL. */
export function draftChange({
  draft,
  pushed,
}: {
  draft: string
  pushed: string
}):
  | { navigate: false }
  | { navigate: true; q: string | undefined; replace: boolean } {
  if (draft === pushed) return { navigate: false }
  // Entering the search is worth a history entry — Back must return to the index rather than leave
  // the site. Everything after it replaces, including the keystrokes still in flight behind the
  // loader: typing "courgette" is one entry, not nine.
  return { navigate: true, q: draft || undefined, replace: pushed !== '' }
}
