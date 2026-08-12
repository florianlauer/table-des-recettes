/**
 * The one gesture on these screens whose fraction is genuinely known: the client compresses, draws a
 * ticket and pushes the bytes, file after file.
 *
 * No byte-level progress: `fetch` does not expose upload progress, and getting it would mean going
 * back to `XMLHttpRequest` for nothing — the canvas compression dominates the time on a phone photo,
 * which is why it carries most of the weight below.
 */

import type { MeasuredProgress } from './gestureProgress'

export type UploadPhase = 'compression' | 'ticket' | 'upload'

export type UploadPosition = {
  /** Files fully finished. */
  done: number
  total: number
  phase: UploadPhase
}

/**
 * One reading of the upload, fraction and sentence together. They were two exported functions called
 * side by side at every site with the same three arguments — which is three chances for the bar and its
 * caption to disagree on how many files are done.
 */
export function uploadProgress(position: UploadPosition): MeasuredProgress {
  return { fraction: uploadFraction(position), text: uploadNote(position) }
}

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

function uploadFraction({ done, total, phase }: UploadPosition): number {
  if (total <= 0) return 0
  const share = (done + PHASE_FLOOR[phase]) / total
  return share < 0 ? 0 : share > 1 ? 1 : share
}

function uploadNote({ done, total, phase }: UploadPosition): string {
  const label = PHASE_LABEL[phase]
  if (total <= 1) return `${label}…`
  return `${label} ${Math.min(done + 1, total)} / ${total} pages…`
}
