import { useId } from 'react'
import type { Gesture, GestureResult } from '../lib/gestures'
import type { Gestures, ReportProgress } from '../lib/useGestures'
import { GestureFeedback } from './-GestureFeedback'

export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,image/webp'

/**
 * The file inputs get the same contract as the buttons: the slowest surfaces of the workshop were the
 * only mute ones.
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
  multiple = false,
  disabled = false,
}: {
  gestures: Gestures
  gesture: Gesture
  label: string
  pendingLabel: string
  onFiles: (files: File[], report: ReportProgress) => Promise<GestureResult>
  multiple?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const labelId = `${id}-label`
  const running = gestures.running(gesture)
  const outcome = gestures.outcome(gesture)
  const inert = disabled || running !== null || gestures.blocked(gesture)

  return (
    <label className="admin-page__field">
      <span id={labelId}>{running ? pendingLabel : label}</span>
      <input
        type="file"
        multiple={multiple}
        accept={IMAGE_ACCEPT}
        disabled={inert}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length === 0) return
          void gestures.run(gesture, { pendingLabel }, (report) =>
            onFiles(files, report),
          )
        }}
      />

      <GestureFeedback
        running={running}
        outcome={outcome}
        labelledBy={labelId}
      />
    </label>
  )
}
