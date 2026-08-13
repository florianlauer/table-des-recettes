/**
 * What the bar under a running control shows. Three regimes, one function, so the screen cannot
 * disagree with itself.
 *
 * The 400 ms floor is the contract DESIGN.md § Résistance already sets for the storefront:
 * "Chargement… n'apparaît qu'au-delà du délai du routeur, jamais sur un chargement rapide." A
 * mutation answering in 250 ms therefore flashes nothing.
 *
 * The 95 % ceiling exists so the bar never promises an imminent end it cannot know: past the
 * journalled duration it stops moving and says so in words instead.
 */

/** Nothing is drawn before this — a fast answer must not flash a bar. */
export const PROGRESS_DELAY_MS = 400

/** An estimated bar stops here. Only a real fraction ever reaches 100 %. */
export const PROGRESS_CEILING = 0.95

/** How long a settled promise may wait for the server state to confirm before the screen says so. */
export const CONFIRMATION_DELAY_MS = 3_000

/** A fraction the client actually measured — an upload, page by page. */
export type MeasuredProgress = { fraction: number; text: string }

export type ProgressView = {
  visible: boolean
  /** `null` means: draw no bar at all, only the note. */
  fraction: number | null
  text: string
  /** Spelled out for `aria-valuetext`; the visible note reads too telegraphically aloud. */
  valueText: string
  /** The new monotonic maximum. Pure: it computes the value, the caller stores it. */
  nextFloor: number
}

export function formatElapsed(ms: number): string {
  const seconds = Math.round(Math.max(0, finite(ms)) / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

export function progressView({
  startedAt,
  now,
  progress,
  estimateMs,
  floor,
  settlingSince = null,
}: {
  startedAt: number
  now: number
  progress: MeasuredProgress | null
  estimateMs: number | null
  floor: number
  /** When the action resolved and the gesture began waiting for the server state to confirm. */
  settlingSince?: number | null
}): ProgressView {
  const elapsedMs = Math.max(0, finite(now) - finite(startedAt))
  const base = clamp01(floor)

  if (elapsedMs < PROGRESS_DELAY_MS)
    return {
      visible: false,
      fraction: null,
      text: '',
      valueText: '',
      nextFloor: base,
    }

  const delayed =
    settlingSince !== null &&
    finite(now) - finite(settlingSince) >= CONFIRMATION_DELAY_MS

  if (progress !== null) {
    const fraction = Math.max(base, clamp01(progress.fraction))
    return {
      visible: true,
      fraction,
      text: note(progress.text, delayed),
      valueText: `${Math.round(fraction * 100)} %`,
      nextFloor: fraction,
    }
  }

  const elapsed = formatElapsed(elapsedMs)

  // A journal too thin to estimate from, or a configuration whose latency nobody has measured yet:
  // the elapsed time alone, and no bar. Better silent than invented.
  if (!isUsableEstimate(estimateMs))
    return {
      visible: true,
      fraction: null,
      text: note(`${elapsed} · pas d’estimation`, delayed),
      valueText: `${elapsed} écoulées, durée inconnue`,
      nextFloor: base,
    }

  const estimate = estimateMs
  if (elapsedMs > estimate) {
    const fraction = Math.max(base, PROGRESS_CEILING)
    return {
      visible: true,
      fraction,
      text: note(`${elapsed} · plus long que d’habitude`, delayed),
      valueText: `${elapsed} écoulées, plus long que d’habitude`,
      nextFloor: fraction,
    }
  }

  const fraction = Math.max(
    base,
    Math.min(elapsedMs / estimate, PROGRESS_CEILING),
  )
  const typical = formatElapsed(estimate)
  return {
    visible: true,
    fraction,
    text: note(`${elapsed} / ~${typical} d’habitude`, delayed),
    valueText: `${elapsed} écoulées sur environ ${typical} d’habitude`,
    nextFloor: fraction,
  }
}

function note(text: string, delayed: boolean): string {
  return delayed ? `${text} · confirmation retardée` : text
}

/** A predicate, so the branch below narrows on its own instead of asserting the type back. */
function isUsableEstimate(estimateMs: number | null): estimateMs is number {
  return estimateMs !== null && Number.isFinite(estimateMs) && estimateMs > 0
}

function clamp01(value: number): number {
  const safe = finite(value)
  return safe < 0 ? 0 : safe > 1 ? 1 : safe
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}
