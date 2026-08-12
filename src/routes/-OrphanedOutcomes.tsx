import { useEffect, useRef } from 'react'
import { gestureId } from '../lib/gestures'
import type { Gestures } from '../lib/useGestures'

/**
 * The message of a gesture whose row is gone. Accepting, publishing or deleting takes the recipe out
 * of the list, and a result printed under that row would be unmounted before anyone read it.
 *
 * The focus moves here only if it was still inside the row that vanished: when a focused element is
 * removed, no `focusin` fires, so `lastFocusedRowId` still names it — whereas an operator who moved
 * on to another row, or to the token field, has already overwritten it and keeps their cursor.
 */
export function OrphanedOutcomes({
  gestures,
  claimFocus,
}: {
  gestures: Gestures
  /** True when a row that held the focus disappeared while working. */
  claimFocus: boolean
}) {
  const outcomes = gestures.orphanedOutcomes()
  const heading = useRef<HTMLParagraphElement | null>(null)
  const claimed = useRef(false)

  useEffect(() => {
    if (!claimFocus || outcomes.length === 0 || claimed.current) return
    claimed.current = true
    heading.current?.focus()
  }, [claimFocus, outcomes.length])

  if (outcomes.length === 0) return null

  return (
    <>
      {outcomes.map((outcome) => (
        <p
          className="gesture__note"
          role="status"
          tabIndex={-1}
          ref={heading}
          key={`${gestureId(outcome.gesture)}:${outcome.token}`}
        >
          {outcome.result.text}
        </p>
      ))}
    </>
  )
}
