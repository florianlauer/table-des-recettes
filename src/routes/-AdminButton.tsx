import { useId } from 'react'
import type { Gesture, GestureResult } from '../lib/gestures'
import type { Gestures, ReportProgress } from '../lib/useGestures'
import { useGroupedReason } from './-AdminActions'

/**
 * Four kinds, told apart before reading: the one gesture a zone exists for, its siblings, what
 * destroys, and what only toggles or reveals. DESIGN.md § `/admin` — le registre de tri.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

/** The row's name as the activity bar should print it: a heading's text, or a title field's value. */
export function subjectFrom(titleId: string | undefined): string | null {
  if (!titleId) return null
  const node = document.getElementById(titleId)
  const text =
    node instanceof HTMLInputElement ? node.value : (node?.textContent ?? '')
  return text.trim() || null
}

/**
 * One control, one gesture. What the gesture is doing and what came of it go to the activity bar at
 * the top of the window; nothing opens next to the button, so nothing around it moves.
 *
 * The two labels are both rendered, stacked in a single grid cell with the inactive one hidden, so
 * the button keeps the width of the longer of the two. Nothing moves when "Embellir" becomes
 * "Embellissement…".
 */
export function AdminButton({
  gestures,
  gesture,
  label,
  pendingLabel,
  run,
  variant = 'secondary',
  confirm,
  disabled = false,
  blockedReason,
  estimateMs = null,
  settle = false,
  subject,
  titleId,
  describedBy,
}: {
  gestures: Gestures
  gesture: Gesture
  label: string
  pendingLabel: string
  run: (report: ReportProgress) => Promise<GestureResult>
  variant?: ButtonVariant
  /** Asked before anything happens, exactly as before — a purge and a deletion are irreversible. */
  confirm?: string
  disabled?: boolean
  /** Replaces a `title=`: unreliable to a screen reader, unreachable by touch. */
  blockedReason?: string
  estimateMs?: number | null
  settle?: boolean
  /** What the gesture acts on, for the activity bar. Defaults to the text of `titleId`. */
  subject?: string
  /** The row's title, read when pressed so the activity bar names the row. */
  titleId?: string
  /** Text that says what a terse label acts on, such as the line an « Annuler » cancels. */
  describedBy?: string
}) {
  const id = useId()
  const reasonId = `${id}-reason`
  const running = gestures.running(gesture)
  // A sibling's gesture also locks this one; the activity bar already says what runs, so only the
  // operator's own precondition is worth a sentence.
  const inert = disabled || running !== null || gestures.blocked(gesture)
  const reason = disabled ? (blockedReason ?? null) : null
  const grouped = useGroupedReason(reasonId, reason)

  const button = (
    <button
      type="button"
      className={`btn btn--${variant}`}
      disabled={inert}
      aria-busy={running !== null || undefined}
      aria-describedby={
        [describedBy, reason && reasonId].filter(Boolean).join(' ') || undefined
      }
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return
        void gestures.run(
          gesture,
          {
            pendingLabel,
            subject: subject ?? subjectFrom(titleId),
            estimateMs,
            settle,
          },
          (report) => run(report),
        )
      }}
    >
      <span className="btn__labels">
        <span
          className={running ? 'btn__label btn__label--ghost' : 'btn__label'}
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
  )

  if (grouped || !reason) return button

  // Outside an `AdminActions` group, the control keeps its reason under it.
  return (
    <div className="gesture-control">
      {button}
      <p className="admin-page__blocked" id={reasonId}>
        {reason}
      </p>
    </div>
  )
}
