import { useEffect, useState } from 'react'

/**
 * A value as it stands once it has stopped changing. What `useSearchDraft` does for the index's
 * search field, without the URL: that hook owns a navigation rule and a `pushed` ref, and neither
 * means anything to a field whose only consumer is a query argument.
 *
 * The point is the query key. A subscription per keystroke is what this exists to avoid — typing
 * "blanquette" is one round trip, not ten.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return settled
}
