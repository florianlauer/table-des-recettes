import { useId } from 'react'
import type { Gesture } from '../lib/gestures'
import type { GestureResult } from '../lib/gestureRegistry'
import type { Gestures, ReportProgress } from '../lib/useGestures'
import { GestureProgress } from './-GestureProgress'

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
  offset = 0,
}: {
  gestures: Gestures
  gesture: Gesture
  label: string
  pendingLabel: string
  onFiles: (files: File[], report: ReportProgress) => Promise<GestureResult>
  multiple?: boolean
  disabled?: boolean
  offset?: number
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

      {running && (
        <GestureProgress
          startedAt={running.startedAt}
          estimateMs={running.estimateMs}
          progress={running.progress}
          token={running.token}
          offset={offset}
          labelledBy={labelId}
        />
      )}

      {outcome && (
        <p className="gesture__note" role="status" key={outcome.token}>
          {outcome.result.text}
        </p>
      )}
    </label>
  )
}
