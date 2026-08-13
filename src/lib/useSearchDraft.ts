/**
 * The index's search field: local while typing, committed to the URL a debounce later.
 *
 * The rules it applies — which `q` to adopt, when to navigate, whether that navigation is worth a
 * history entry — live in `searchDraft.ts`, where they are covered. This holds only the state, the
 * timer and the ref that remembers what was pushed.
 */
import { useEffect, useRef, useState } from 'react'
import { draftChange, urlChange } from './searchDraft'

/** Long enough that typing "courgette" is one Convex subscription rather than nine. */
const DEBOUNCE_MS = 250

export function useSearchDraft({
  q,
  commit,
}: {
  q: string | undefined
  commit: (change: { q: string | undefined; replace: boolean }) => void
}) {
  const [draft, setDraft] = useState(q ?? '')
  const pushed = useRef(q ?? '')

  // Callers pass a fresh closure every render; behind a ref, a render the field had nothing to do
  // with cannot re-arm the debounce.
  const latestCommit = useRef(commit)
  useEffect(() => {
    latestCommit.current = commit
  })

  // The one place `pushed` is written. There are two ways to commit — a debounce behind the keystrokes
  // and the clear control, which does not wait — but only one rule deciding what the URL owes, and the
  // invariant `searchDraft.ts` exists to protect is maintained here or nowhere. Held in a ref for the
  // same reason `latestCommit` is: read from inside the debounce effect, a fresh closure in its
  // dependencies would re-arm the timer on every unrelated render.
  const push = useRef<(next: string) => void>(() => {})
  push.current = (next: string) => {
    const change = draftChange({ draft: next, pushed: pushed.current })
    if (!change.navigate) return
    pushed.current = next
    latestCommit.current(change)
  }

  useEffect(() => {
    const change = urlChange({ q, pushed: pushed.current })
    if (!change.adopt) return
    pushed.current = change.draft
    setDraft(change.draft)
  }, [q])

  // Decided when the timer fires rather than when it is armed: a navigation that lands in between
  // moves `pushed`, and the pending push is then either stale or already satisfied.
  useEffect(() => {
    const id = setTimeout(() => push.current(draft), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft])

  // The clear control is not a keystroke: it commits at once rather than through the debounce, which
  // for a deliberate press would read as a quarter second of nothing. The debounce that fires
  // afterwards finds the draft and `pushed` already equal, so it does nothing.
  const clear = () => {
    setDraft('')
    push.current('')
  }

  return [draft, setDraft, clear] as const
}
