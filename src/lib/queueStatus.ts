import { LEASE_MS } from './queueContract'

export function applyClockOffset({
  clientNow,
  offsetMs,
}: {
  clientNow: number
  offsetMs: number
}): number {
  return clientNow + offsetMs
}

export function isLeaseLive({
  startedAt,
  now,
}: {
  startedAt: number | null
  now: number
}): boolean {
  return startedAt !== null && startedAt > now - LEASE_MS
}

export function isQueueStopped({
  pendingCount,
  leaseStartedAt,
  nextAttemptAt,
  now,
}: {
  pendingCount: number
  leaseStartedAt: number | null
  nextAttemptAt: number | null
  now: number
}): boolean {
  const leaseLive = isLeaseLive({ startedAt: leaseStartedAt, now })
  const hasExpiredLease = leaseStartedAt !== null && !leaseLive
  const retryScheduled = nextAttemptAt !== null && nextAttemptAt > now
  return (pendingCount > 0 || hasExpiredLease) && !leaseLive && !retryScheduled
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
  if (minutes < 1) return "moins d'une minute"
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

export type QueueButtonState = {
  label: string
  disabled: boolean
}

export function queueButtonState({
  pendingCount,
  leaseStartedAt,
  nextAttemptAt,
  retryAt,
  now,
}: {
  pendingCount: number
  leaseStartedAt: number | null
  nextAttemptAt: number | null
  retryAt: number | null
  now: number
}): QueueButtonState {
  const waitUntil = Math.max(nextAttemptAt ?? 0, retryAt ?? 0)
  if (waitUntil > now) {
    return {
      label: `Reprise dans ${formatRemaining({ deadline: waitUntil, now })}`,
      disabled: true,
    }
  }

  const leaseLive = isLeaseLive({ startedAt: leaseStartedAt, now })
  if (leaseLive) return { label: 'Extraction en cours', disabled: true }
  if (leaseStartedAt !== null) {
    return { label: 'Relancer la file', disabled: false }
  }
  if (pendingCount > 0) {
    return { label: "Démarrer l'extraction", disabled: false }
  }
  return { label: 'Rien à extraire', disabled: true }
}
