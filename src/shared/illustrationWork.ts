/**
 * The transition matrix, mirrored for the screen. The server refuses on its own — this only decides
 * what to grey out, so a button is never offered for a gesture that would come back as an error.
 *
 * It lives here rather than in the route because no component test covers that screen (R7): the
 * only way this logic gets checked is by being a pure function.
 */

export type BeautifyStatus = 'idle' | 'generating' | 'review' | 'failed'

// How long a generation may stay `generating` before the abandon button is offered. Ten times the
// 9,1 s measured by T13: long enough that a slow answer is not mistaken for a dead action. Declared
// here and not in the Convex module, so the screen can read it without dragging a server module —
// prompt included — into the browser bundle.
export const BEAUTIFY_LEASE_MS = 90_000

export type IllustrationState = {
  beautifyStatus: BeautifyStatus
  beautifiedAccepted: boolean
  hasOriginal: boolean
  hasCandidate: boolean
  noPhotoAvailable: boolean
  beautifyStartedAt: number | null
}

export type IllustrationActions = {
  generate: boolean
  accept: boolean
  reject: boolean
  unpublish: boolean
  deleteCandidate: boolean
  abandon: boolean
  replace: boolean
  detach: boolean
  markNoPhoto: boolean
  unmarkNoPhoto: boolean
}

export function illustrationActions(
  state: IllustrationState,
  { now, leaseMs }: { now: number; leaseMs: number },
): IllustrationActions {
  const {
    beautifyStatus,
    beautifiedAccepted,
    hasOriginal,
    hasCandidate,
    noPhotoAvailable,
    beautifyStartedAt,
  } = state
  const running = beautifyStatus === 'generating'
  const waiting = beautifyStatus === 'review'
  // A candidate kept by a de-publication: idle, still there, and nobody owes it a verdict.
  const kept = beautifyStatus === 'idle' && hasCandidate && !beautifiedAccepted

  return {
    generate:
      hasOriginal &&
      !beautifiedAccepted &&
      (beautifyStatus === 'idle' || beautifyStatus === 'failed'),
    accept: waiting,
    // Reserved to `review`. A kept candidate's attempt already reads `accepted`, and rewriting that
    // would be a second arbitration on the same render.
    reject: waiting,
    unpublish: beautifiedAccepted,
    deleteCandidate: kept,
    // Only once the lease has run out: before that a slow answer is not a dead action, and
    // abandoning it would strand a call that is still going to be billed.
    abandon: running && now - (beautifyStartedAt ?? 0) >= leaseMs,
    replace: !beautifiedAccepted,
    detach: hasOriginal && !beautifiedAccepted,
    // Only offered where the statement can be true: saying "the source has no photo" next to a photo
    // is not a claim about the source, it is a contradiction.
    markNoPhoto: !hasOriginal && !noPhotoAvailable,
    unmarkNoPhoto: noPhotoAvailable,
  }
}
