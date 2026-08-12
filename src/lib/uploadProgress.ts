/**
 * The one gesture on these screens whose fraction is genuinely known: the client compresses, draws a
 * ticket and pushes the bytes, file after file.
 *
 * No byte-level progress: `fetch` does not expose upload progress, and getting it would mean going
 * back to `XMLHttpRequest` for nothing — the canvas compression dominates the time on a phone photo,
 * which is why it carries most of the weight below.
 */

export type UploadPhase = 'compression' | 'ticket' | 'upload'

/** Where each phase begins, as a share of one file. */
export const PHASE_FLOOR: Record<UploadPhase, number> = {
  compression: 0,
  ticket: 0.6,
  upload: 0.65,
}

const PHASE_LABEL: Record<UploadPhase, string> = {
  compression: 'Compression',
  ticket: 'Autorisation',
  upload: 'Envoi',
}

export function uploadFraction({
  done,
  total,
  phase,
}: {
  /** Files fully finished. */
  done: number
  total: number
  phase: UploadPhase
}): number {
  if (total <= 0) return 0
  const share = (done + PHASE_FLOOR[phase]) / total
  return share < 0 ? 0 : share > 1 ? 1 : share
}

export function uploadNote({
  done,
  total,
  phase,
}: {
  done: number
  total: number
  phase: UploadPhase
}): string {
  const label = PHASE_LABEL[phase]
  if (total <= 1) return `${label}…`
  return `${label} ${Math.min(done + 1, total)} / ${total} pages…`
}
