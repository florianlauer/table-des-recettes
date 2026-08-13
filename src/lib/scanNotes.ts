import { formatCount } from './formatCount'
import { formatMs, formatUsd } from './formatNumber'
import { formatAge } from './queueStatus'

/**
 * What a scan has to say that no column can hold: the titles it produced, why it failed, what its
 * last call cost. The queue table answers comparisons; these answer "what happened to this one".
 *
 * A pure function rather than six conditionals in the row, because the order of these lines is a
 * decision — the failure before the cost, the cost last — and an order is worth a test.
 */
export type ScannedForNotes = {
  drafts: { title: string; ingredientsInferred: boolean }[]
  draftsTruncated: boolean
  error: string | null
  purgedAt: number | null
  lastAttempt: {
    model: string
    servedProvider: string | null
    latencyMs: number
    costUsd: number
    failureKind: string | null
    repairCount: number
  } | null
}

export function scanNotes({
  scan,
  now,
}: {
  scan: ScannedForNotes
  now: number
}): string[] {
  const notes: string[] = []

  if (scan.error) notes.push(`Échec : ${scan.error}`)

  if (scan.draftsTruncated) {
    notes.push(
      `Plus de ${scan.drafts.length} brouillons : extraction probablement défectueuse.`,
    )
  }

  if (scan.drafts.length > 0) {
    notes.push(
      scan.drafts.map((draft) => draft.title || 'sans titre').join(' · '),
    )
  }

  if (scan.drafts.some((draft) => draft.ingredientsInferred)) {
    notes.push('Ingrédients déduits à vérifier.')
  }

  if (scan.purgedAt !== null) {
    notes.push(
      `Photo purgée il y a ${formatAge({ timestamp: scan.purgedAt, now })}.`,
    )
  }

  if (scan.lastAttempt) {
    const attempt = scan.lastAttempt
    notes.push(
      [
        attempt.model,
        attempt.servedProvider ?? 'provider inconnu',
        formatMs(attempt.latencyMs),
        formatUsd(attempt.costUsd),
        attempt.failureKind ?? 'succès',
        formatCount(attempt.repairCount, 'réparation'),
      ].join(' · '),
    )
  }

  return notes
}
