/**
 * Every gesture answers the same shape, so one runner can drive them all. The mutations do not: one
 * returns a bare string, another a four-branch status, a third an `{ ok, error }` refusal. The
 * adaptation happens here rather than inside an `onClick`, which is also how these sentences became
 * testable.
 */
import { formatCount } from './formatCount'
import type { GestureResult } from './gestures'
import { formatRemaining } from './queueStatus'

export type PurgeResult = 'purged' | 'deferred' | 'already_purged'

export type StartExtractionResult =
  | { status: 'scheduled' }
  | { status: 'already_running' }
  | { status: 'no_work' }
  | { status: 'rate_limited'; retryAt: number }

export function purgeMessage(result: PurgeResult): GestureResult {
  if (result === 'purged') return { ok: true, text: 'Photo purgée.' }
  if (result === 'deferred')
    return {
      ok: false,
      text: 'Purge reportée : une extraction est en cours.',
    }
  return { ok: true, text: 'Photo déjà purgée.' }
}

export function extractionMessage(
  result: StartExtractionResult,
  { now }: { now: number },
): GestureResult {
  switch (result.status) {
    case 'scheduled':
      return { ok: true, text: 'Extraction planifiée.' }
    case 'already_running':
      return { ok: false, text: 'Une extraction est déjà en cours.' }
    case 'no_work':
      return { ok: false, text: 'Rien à extraire.' }
    case 'rate_limited':
      return {
        ok: false,
        text: `Limite atteinte. Reprise possible dans ${formatRemaining({
          deadline: result.retryAt,
          now,
        })}.`,
      }
  }
}

export type RescanResult =
  | { ok: true; start: StartExtractionResult }
  | { ok: false; error: string }

/** A rescan answers twice: the requeue, then the start of the queue it shares with « Lancer ». */
export function rescanMessage(
  result: RescanResult,
  { now }: { now: number },
): GestureResult {
  if (!result.ok) return { ok: false, text: result.error }
  // The running drain picks the next pending scan on its own, this one included.
  if (result.start.status === 'already_running')
    return {
      ok: true,
      text: 'Scan remis en file : l’extraction en cours le prendra.',
    }
  const started = extractionMessage(result.start, { now })
  // The drafts are gone whatever the queue said: a refusal must not read as « nothing happened ».
  return started.ok
    ? started
    : { ok: false, text: `Scan remis en file. ${started.text}` }
}

/**
 * Both extraction buttons start the whole queue, not one scan. `null` means nothing else waits, and
 * an unknown count warns too: silence must mean « nothing else waits ».
 */
export function othersPendingWarning({
  pendingCount,
  selfPending,
}: {
  pendingCount: number | undefined
  selfPending: boolean
}): string | null {
  if (pendingCount === undefined)
    return 'La file extrait tous les scans en attente, pas seulement celui-ci.'
  const others = Math.max(0, pendingCount - (selfPending ? 1 : 0))
  if (others === 0) return null
  return `La file extrait aussi ${formatCount(others, 'autre scan en attente', 'autres scans en attente')}.`
}

/** Names the files that failed rather than counting them: a count does not say what to retry. */
export function uploadMessage({
  total,
  failures,
}: {
  total: number
  failures: readonly string[]
}): GestureResult {
  if (failures.length === 0)
    return {
      ok: true,
      text: `${formatCount(total, 'scan créé', 'scans créés')}.`,
    }
  return { ok: false, text: failures.join(' · ') }
}

export function outcomeMessage(outcome: {
  ok: boolean
  error?: string
  message?: string
}): GestureResult {
  if (outcome.ok) return { ok: true, text: outcome.message ?? 'Fait.' }
  return { ok: false, text: outcome.error ?? 'Échec.' }
}

/**
 * Anything *thrown*: a mutation, an action, `fetch`, the canvas compression. Without this branch a
 * rejected promise would leave its gesture running for good.
 */
export function thrownMessage(error: unknown): GestureResult {
  if (error instanceof Error) return { ok: false, text: error.message }
  if (typeof error === 'string' && error !== '')
    return { ok: false, text: error }
  return { ok: false, text: 'Échec inattendu.' }
}
