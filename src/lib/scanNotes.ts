import type { api } from '../../convex/_generated/api'
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
type Scan = (typeof api.admin.listScans)['_returnType'][number]
type Attempt = NonNullable<Scan['lastAttempt']>

/**
 * Every field derived from the query rather than retyped, so a rename on the wire fails here at
 * compile time instead of quietly never reaching the detail row. Narrowed to what the notes read —
 * `Pick`, not the whole row — so a test fixture stays five fields, not a whole scan.
 */
export type ScannedForNotes = Pick<
  Scan,
  'draftsTruncated' | 'error' | 'purgedAt'
> & {
  drafts: readonly Pick<
    Scan['drafts'][number],
    'title' | 'ingredientsInferred'
  >[]
  lastAttempt: Pick<
    Attempt,
    | 'model'
    | 'servedProvider'
    | 'latencyMs'
    | 'costUsd'
    | 'failureKind'
    | 'repairCount'
  > | null
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
