import { useEffect, useRef } from 'react'
import { gestureNoteMark, gestureNoteReading } from '../lib/gestureNote'
import { outcomeKey } from '../lib/gestureRegistry'
import type { Outcome } from '../lib/gestureRegistry'
import type { Gestures } from '../lib/useGestures'

/**
 * The message of a gesture whose row is gone. Accepting, publishing or deleting takes the recipe out
 * of the list, and a result printed under that row would be unmounted before anyone read it.
 *
 * The focus moves here only if it was still inside the row that vanished: when a focused element is
 * removed, no `focusin` fires, so `lastFocusedRowId` still names it — whereas an operator who moved
 * on to another row, or to the token field, has already overwritten it and keeps their cursor.
 *
 * Which message takes the focus is read off the outcomes themselves, so the node is named rather than
 * guessed. Honouring the claim clears it, which is also what lets a second disappearance be honoured.
 */
export function OrphanedOutcomes({
  gestures,
  keep = () => true,
}: {
  gestures: Gestures
  /**
   * Which of the orphaned outcomes this instance owns. A screen with sections publishes each message
   * where its row was, so several instances share the set and each takes its own — the default takes
   * them all, for a screen that has one list.
   */
  keep?: (outcome: Outcome) => boolean
}) {
  const outcomes = gestures.orphanedOutcomes().filter(keep)
  const nodes = useRef(new Map<string, HTMLParagraphElement>())
  const claiming = outcomes.find((outcome) => outcome.stealsFocus) ?? null
  const claimingKey = claiming === null ? null : outcomeKey(claiming)

  useEffect(() => {
    if (claiming === null || claimingKey === null) return
    nodes.current.get(claimingKey)?.focus()
    gestures.releaseFocusClaim(claiming.gesture)
    // Keyed by the outcome, not by the array: the effect fires for the message that asked, once.
  }, [claimingKey])

  if (outcomes.length === 0) return null

  return (
    <>
      {outcomes.map((outcome) => {
        const key = outcomeKey(outcome)
        return (
          <p
            className="gesture__note"
            data-ok={outcome.result.ok}
            role="status"
            tabIndex={-1}
            key={key}
            ref={(node) => {
              if (node === null) nodes.current.delete(key)
              else nodes.current.set(key, node)
            }}
          >
            <span aria-hidden="true">{gestureNoteMark(outcome.result)} </span>
            <span className="visually-hidden">
              {gestureNoteReading(outcome.result)}{' '}
            </span>
            {outcome.result.text}
          </p>
        )
      })}
    </>
  )
}
