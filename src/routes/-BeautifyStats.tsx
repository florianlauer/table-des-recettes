import { beautifyGroupKey } from '../lib/beautifyStats'
import type { WireBeautifySummary } from '../lib/beautifyStats'
import { formatCount } from '../lib/formatCount'

/**
 * What the image generations have cost and how they have landed, one block per configuration. Split
 * by model, prompt and served provider, because averaging across a routing change describes nothing.
 */
export function BeautifyStats({
  groups,
  error,
  estimateMs,
}: {
  groups: WireBeautifySummary[] | undefined
  error: Error | null
  estimateMs: number | null
}) {
  return (
    <section className="admin-page__stats">
      <h2>Générations d'images</h2>
      {error && <p role="alert">{error.message}</p>}
      {groups?.length === 0 && <p>Aucune génération journalisée.</p>}
      {estimateMs === null && groups !== undefined && groups.length > 0 && (
        <p>
          Pas encore assez d'appels sur la configuration en service pour estimer
          une durée.
        </p>
      )}
      {groups?.map((group) => (
        <article key={beautifyGroupKey(group)} className="admin-page__stat">
          <h3>
            {group.model} · {group.servedProvider ?? 'provider inconnu'} ·
            prompt {group.promptVersion}
            {group.isCurrent && ' · en service'}
          </h3>
          <p>
            {formatCount(group.attempts, 'appel')} ·{' '}
            {formatCount(group.accepted, 'accepté', 'acceptés')} ·{' '}
            {formatCount(group.rejected, 'rejeté', 'rejetés')} · {group.pending}{' '}
            en attente ·{' '}
            {formatCount(group.discarded, 'abandonné', 'abandonnés')}
          </p>
          <p>
            {formatCount(
              group.technicalFailures,
              'échec technique',
              'échecs techniques',
            )}
            {group.failureKinds.length > 0 &&
              ` · ${group.failureKinds
                .map(({ kind, count }) => `${kind} ${count}`)
                .join(', ')}`}
          </p>
          <p>
            {group.averageCostUsd.toFixed(4)} USD en moyenne ·{' '}
            {group.totalCostUsd.toFixed(4)} USD au total ·{' '}
            {Math.round(group.averageLatencyMs)} ms en moyenne
          </p>
          {group.unreportedCostCalls > 0 && (
            <p>
              {formatCount(group.unreportedCostCalls, 'appel')} sans coût
              rapporté : le total est un plancher, pas un montant exact.
            </p>
          )}
          {group.excessiveCostCalls > 0 && (
            <p role="alert">
              {formatCount(
                group.excessiveCostCalls,
                'appel facturé',
                'appels facturés',
              )}{' '}
              bien au-dessus du coût mesuré.
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
