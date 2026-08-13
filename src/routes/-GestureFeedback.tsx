import { gestureNoteMark, gestureNoteReading } from '../lib/gestureNote'
import type { Outcome, Run } from '../lib/gestureRegistry'
import { GestureProgress } from './-GestureProgress'

/**
 * What every gesture control owes the operator once it has been pressed: how long it has been working,
 * and what came of it. A button and a file input differ in how they are triggered, not in what they
 * report — so the rule that a settled message belongs to its control *unless* its row is gone lives
 * here, once, rather than being written the same way in each of them.
 */
export function GestureFeedback({
  running,
  outcome,
  labelledBy,
}: {
  running: Run | null
  outcome: Outcome | null
  /** Ids naming what progresses — the gesture and, when there is one, its row. */
  labelledBy?: string
}) {
  return (
    <>
      {running && (
        <GestureProgress
          startedAt={running.startedAt}
          estimateMs={running.estimateMs}
          progress={running.progress}
          settlingSince={running.settlingSince}
          token={running.token}
          labelledBy={labelledBy}
        />
      )}

      {/* Nothing when orphaned: the gesture took its own row away, and the section republishes the
          message this control can no longer print. Keyed by token so two identical messages in a row
          are two nodes, and the second one is announced instead of being swallowed as unchanged. */}
      {outcome && !outcome.orphaned && (
        <p
          className="gesture__note"
          data-ok={outcome.result.ok}
          role="status"
          key={outcome.token}
        >
          <span aria-hidden="true">{gestureNoteMark(outcome.result)} </span>
          <span className="visually-hidden">
            {gestureNoteReading(outcome.result)}{' '}
          </span>
          {outcome.result.text}
        </p>
      )}
    </>
  )
}
