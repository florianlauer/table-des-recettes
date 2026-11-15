import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { getClock, getServerTick, getTick, subscribeToTick } from '../lib/clock'
import { progressView } from '../lib/gestureProgress'
import type { MeasuredProgress } from '../lib/gestureProgress'

/**
 * One line of the activity bar: what runs, on what, for how long, and — when it can be known — how far
 * along. A client gesture and a job the server owns draw the same line.
 *
 * Nothing is drawn before `PROGRESS_DELAY_MS`: a mutation answering in 250 ms must not flash a line.
 *
 * It is the only thing on the page beating at 250 ms. The tick comes from a shared store rather than
 * page state, so a running bar re-renders itself and nothing else; forty rows do not rebuild four
 * times a second. `getClock` is already corrected against the server, which is what `startedAt`
 * usually comes from.
 */
export function GestureProgress({
  label,
  subject = null,
  startedAt,
  estimateMs,
  progress = null,
  settlingSince = null,
  token,
}: {
  /** The pending label of the gesture, or the name of the server job. */
  label: string
  /** What it acts on — a recipe title, a scan. */
  subject?: string | null
  /** A server timestamp for a lease, a client one for an upload. */
  startedAt: number
  estimateMs: number | null
  progress?: MeasuredProgress | null
  settlingSince?: number | null
  /** Resets the monotonic floor: a new execution starts from zero, not from the last maximum. */
  token?: number
}) {
  const whatId = useId()
  useSyncExternalStore(subscribeToTick, getTick, getServerTick)
  const now = getClock()

  // Component-local, written in an effect and never during render: the floor belongs to what is
  // displayed, not to the shared registry.
  const floor = useRef(0)
  const seenToken = useRef(token)
  if (seenToken.current !== token) {
    seenToken.current = token
    floor.current = 0
  }

  const view = progressView({
    startedAt,
    now,
    progress,
    estimateMs,
    floor: floor.current,
    settlingSince,
  })

  useEffect(() => {
    floor.current = view.nextFloor
  }, [view.nextFloor])

  if (!view.visible) return null

  return (
    <div className="activity__entry">
      <p className="activity__what" id={whatId}>
        <b>{label}</b>
        {subject && <span className="activity__subject"> · {subject}</span>}
      </p>
      <p className="activity__time">{view.text}</p>
      {view.fraction !== null && (
        <div
          className="activity__bar"
          role="progressbar"
          aria-labelledby={whatId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.fraction * 100)}
          aria-valuetext={view.valueText}
        >
          {/* `scaleX`, not `width`: the fill eases between two ticks without a layout pass. */}
          <div
            className="activity__fill"
            style={{ transform: `scaleX(${view.fraction})` }}
          />
        </div>
      )}
    </div>
  )
}
