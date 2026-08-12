/**
 * Every gesture answers the same shape, so one runner can drive them all. The mutations do not: one
 * returns a bare string, another a four-branch status, a third an `{ ok, error }` refusal. The
 * adaptation happens here rather than inside an `onClick`, which is also how these sentences became
 * testable.
 */
import { formatRemaining } from './queueStatus'

export type GestureResult = { ok: boolean; text: string }

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

/** Names the files that failed rather than counting them: a count does not say what to retry. */
export function uploadMessage({
  total,
  failures,
}: {
  total: number
  failures: readonly string[]
}): GestureResult {
  if (failures.length === 0)
    return { ok: true, text: `${total} scan(s) créé(s).` }
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
