import { LEASE_MS } from '../shared/queueContract'

export function isLeaseLive({
  leaseStartedAt,
  now,
}: {
  leaseStartedAt: number | null
  now: number
}): boolean {
  return leaseStartedAt !== null && leaseStartedAt > now - LEASE_MS
}

export function formatAge({
  timestamp,
  now,
}: {
  timestamp: number
  now: number
}): string {
  const elapsedMs = Math.max(0, now - timestamp)
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return 'moins d’une minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

export function formatRemaining({
  deadline,
  now,
}: {
  deadline: number
  now: number
}): string {
  const remainingMs = Math.max(0, deadline - now)
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.ceil(minutes / 60)
  return `${hours} h`
}

/** The queue facts the server reports, with no clock of their own. */
export type QueueFacts = {
  pendingCount: number
  leaseStartedAt: number | null
  nextAttemptAt: number | null
}

export type QueueButtonState = {
  label: string
  disabled: boolean
}

export type QueueState = {
  leaseLive: boolean
  stopped: boolean
  button: QueueButtonState
}

function buttonFor({
  pendingCount,
  leaseLive,
  expiredLease,
  retryAt,
  now,
}: {
  pendingCount: number
  leaseLive: boolean
  expiredLease: boolean
  retryAt: number | null
  now: number
}): QueueButtonState {
  if (retryAt !== null)
    return {
      label: `Reprise dans ${formatRemaining({ deadline: retryAt, now })}`,
      disabled: true,
    }
  if (leaseLive) return { label: 'Extraction en cours', disabled: true }
  if (expiredLease) return { label: 'Relancer la file', disabled: false }
  if (pendingCount > 0)
    return { label: 'Démarrer l’extraction', disabled: false }
  return { label: 'Rien à extraire', disabled: true }
}

/**
 * Everything the screen shows about the queue, derived once. The parts overlap — a live lease
 * decides both the label and whether the queue counts as stopped — so a single derivation is the
 * only way they cannot disagree.
 */
export function deriveQueueState({
  facts: { pendingCount, leaseStartedAt, nextAttemptAt },
  now,
}: {
  facts: QueueFacts
  now: number
}): QueueState {
  const leaseLive = isLeaseLive({ leaseStartedAt, now })
  const expiredLease = leaseStartedAt !== null && !leaseLive
  const retryAt =
    nextAttemptAt !== null && nextAttemptAt > now ? nextAttemptAt : null
  return {
    leaseLive,
    stopped:
      (pendingCount > 0 || expiredLease) && !leaseLive && retryAt === null,
    button: buttonFor({ pendingCount, leaseLive, expiredLease, retryAt, now }),
  }
}
