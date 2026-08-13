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

  useEffect(() => {
    const change = urlChange({ q, pushed: pushed.current })
    if (!change.adopt) return
    pushed.current = change.draft
    setDraft(change.draft)
  }, [q])

  // Decided when the timer fires rather than when it is armed: a navigation that lands in between
  // moves `pushed`, and the pending push is then either stale or already satisfied.
  useEffect(() => {
    const id = setTimeout(() => {
      const change = draftChange({ draft, pushed: pushed.current })
      if (!change.navigate) return
      pushed.current = draft
      latestCommit.current(change)
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft])

  return [draft, setDraft] as const
}
