import { useId } from 'react'
import type { Gesture } from '../lib/gestures'
import type { GestureResult } from '../lib/gestureRegistry'
import type { Gestures, ReportProgress } from '../lib/useGestures'
import { GestureProgress } from './-GestureProgress'

/**
 * One control, one gesture, and everything the gesture owes the operator: what it is doing, how long
 * it has been doing it, what came of it, and — when it is inert — why.
 *
 * The two labels are both rendered, stacked in a single grid cell with the inactive one hidden, so
 * the button keeps the width of the longer of the two. Nothing moves when "Embellir" becomes
 * "Embellissement…", which is the whole reason a row can be watched while it works.
 */
export function AdminButton({
  gestures,
  gesture,
  label,
  pendingLabel,
  run,
  confirm,
  disabled = false,
  blockedReason,
  estimateMs = null,
  settle = false,
  titleId,
  offset = 0,
}: {
  gestures: Gestures
  gesture: Gesture
  label: string
  pendingLabel: string
  run: (report: ReportProgress) => Promise<GestureResult>
  /** Asked before anything happens, exactly as before — a purge and a deletion are irreversible. */
  confirm?: string
  disabled?: boolean
  /** Replaces a `title=`: unreliable to a screen reader, unreachable by touch. */
  blockedReason?: string
  estimateMs?: number | null
  settle?: boolean
  /** The row's title, so the bar says what progresses rather than progressing anonymously. */
  titleId?: string
  offset?: number
}) {
  const id = useId()
  const labelId = `${id}-label`
  const reasonId = `${id}-reason`
  const running = gestures.running(gesture)
  const outcome = gestures.outcome(gesture)
  const inert = disabled || running !== null || gestures.blocked(gesture)

  // One box around the four nodes: the surrounding sections are flex rows, and without it the bar
  // and the result would line up *beside* the control instead of under it.
  return (
    <div className="gesture-control">
      <button
        type="button"
        disabled={inert}
        aria-describedby={disabled && blockedReason ? reasonId : undefined}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          void gestures.run(
            gesture,
            { pendingLabel, estimateMs, settle },
            (report) => run(report),
          )
        }}
      >
        <span className="btn__labels">
          <span
            className={running ? 'btn__label btn__label--ghost' : 'btn__label'}
            id={labelId}
          >
            {label}
          </span>
          <span
            className={running ? 'btn__label' : 'btn__label btn__label--ghost'}
          >
            {pendingLabel}
          </span>
        </span>
      </button>

      {disabled && blockedReason && (
        <p className="admin-page__blocked" id={reasonId}>
          {blockedReason}
        </p>
      )}

      {running && (
        <GestureProgress
          startedAt={running.startedAt}
          estimateMs={running.estimateMs}
          progress={running.progress}
          settlingSince={running.settlingSince}
          token={running.token}
          offset={offset}
          labelledBy={titleId ? `${labelId} ${titleId}` : labelId}
        />
      )}

      {/* Keyed by token so two identical messages in a row are two nodes, and the second one is
          announced instead of being swallowed as unchanged text. */}
      {outcome && !outcome.orphaned && (
        <p className="gesture__note" role="status" key={outcome.token}>
          {outcome.result.text}
        </p>
      )}
    </div>
  )
}
