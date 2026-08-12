import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getClock, getServerTick, getTick, subscribeToTick } from '../lib/clock'
import { progressView } from '../lib/gestureProgress'
import type { MeasuredProgress } from '../lib/gestureProgress'

/**
 * The bar under the control that started the work — and, for a job the server owns, under the row
 * whose lease is running. Two nodes: the bar and its line of text.
 *
 * It is the only thing on the page beating at 250 ms. The tick comes from a shared store rather than
 * page state, so a running bar re-renders itself and nothing else; forty rows do not rebuild four
 * times a second. `getClock` is already corrected against the server, which is what `startedAt`
 * usually comes from.
 */
export function GestureProgress({
  startedAt,
  estimateMs,
  progress = null,
  settlingSince = null,
  labelledBy,
  token,
}: {
  /** A server timestamp for a lease, a client one for an upload. */
  startedAt: number
  estimateMs: number | null
  progress?: MeasuredProgress | null
  settlingSince?: number | null
  /** Ids naming what progresses — the gesture and its row. Never an anonymous bar. */
  labelledBy?: string
  /** Resets the monotonic floor: a new execution starts from zero, not from the last maximum. */
  token?: number
}) {
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
    <div className="gesture">
      {view.fraction !== null && (
        <div
          className="gesture__bar"
          role="progressbar"
          aria-labelledby={labelledBy}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.fraction * 100)}
          aria-valuetext={view.valueText}
        >
          <div
            className="gesture__fill"
            style={{ width: `${view.fraction * 100}%` }}
          />
        </div>
      )}
      <p className="gesture__note">{view.text}</p>
    </div>
  )
}
