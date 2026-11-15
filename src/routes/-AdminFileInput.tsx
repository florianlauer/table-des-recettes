import type { Gesture, GestureResult } from '../lib/gestures'
import type { Gestures, ReportProgress } from '../lib/useGestures'
import { ButtonLabels } from './-AdminButton'
import type { ButtonVariant } from './-AdminButton'

export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,image/webp'

/**
 * The file inputs get the same contract as the buttons: the slowest surfaces of the workshop were the
 * only mute ones. Progress and result go to the activity bar.
 *
 * It also fixes something that was already broken: the input's value is cleared *before* the gesture
 * starts. Keeping it meant that re-picking the same photo after a failure fired no `change` event at
 * all, and the screen looked dead.
 */
export function AdminFileInput({
  gestures,
  gesture,
  label,
  pendingLabel,
  onFiles,
  variant = 'secondary',
  subject = null,
  multiple = false,
  disabled = false,
}: {
  gestures: Gestures
  gesture: Gesture
  label: string
  pendingLabel: string
  onFiles: (files: File[], report: ReportProgress) => Promise<GestureResult>
  variant?: ButtonVariant
  /** What the upload is for, named in the activity bar. */
  subject?: string | null
  multiple?: boolean
  disabled?: boolean
}) {
  const running = gestures.running(gesture)
  const inert = disabled || running !== null || gestures.blocked(gesture)

  return (
    <label className="admin-page__file">
      {/* The label *is* the control: every caller already passes an imperative ("Photographier une
          page"), and the native button next to it said "Choose File" — its text comes from the
          browser UI language and no attribute reaches it. So it goes under, and the sentence that
          was already there takes the click. It wears the button's face, inert state included. */}
      <span
        className={`btn btn--${variant}`}
        data-inert={inert || undefined}
        aria-busy={running !== null || undefined}
      >
        <ButtonLabels
          label={label}
          pendingLabel={pendingLabel}
          running={running !== null}
        />
      </span>
      <input
        className="visually-hidden"
        type="file"
        multiple={multiple}
        accept={IMAGE_ACCEPT}
        disabled={inert}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length === 0) return
          void gestures.run(gesture, { pendingLabel, subject }, (report) =>
            onFiles(files, report),
          )
        }}
      />
    </label>
  )
}
