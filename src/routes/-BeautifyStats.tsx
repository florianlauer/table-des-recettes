import { beautifyGroupKey, beautifyTotals } from '../lib/beautifyStats'
import { formatCount } from '../lib/formatCount'
import { formatMs, formatRate, formatUsd } from '../lib/formatNumber'
import type { WireBeautifySummary } from '../lib/beautifyStats'
import type { NonEmpty } from '../lib/journalStats'
import { AdminTable, AdminTableDetail } from './-AdminTable'

const COLUMNS = [
  { label: 'Modèle' },
  { label: 'Appels', numeric: true },
  { label: 'Acceptés', numeric: true },
  { label: 'Rejetés', numeric: true },
  { label: 'En attente', numeric: true },
  { label: 'Abandonnés', numeric: true },
  { label: 'Échecs', numeric: true },
  { label: 'Coût moyen', numeric: true },
  { label: 'Coût total', numeric: true },
  { label: 'Durée moyenne', numeric: true },
] as const

/**
 * What the image generations have cost and how they have landed, split by model, prompt and served
 * provider — averaging across a routing change describes nothing.
 *
 * In columns, like the extraction journal and for the same reason: the question is « is this
 * configuration still worth its price », which is a comparison. It read as stacked paragraphs until
 * the register was written down, and a pile of paragraphs answers one configuration at a time.
 */
export function BeautifyStats({
  rows,
}: {
  rows: NonEmpty<WireBeautifySummary>
}) {
  const totals = beautifyTotals(rows)

  return (
    <AdminTable columns={COLUMNS}>
      {rows.map((group) => (
        <tbody key={beautifyGroupKey(group)}>
          <tr>
            <th scope="row">
              {group.model}
              {group.isCurrent && (
                <span className="admin-table__flag"> en service</span>
              )}
            </th>
            <td className="admin-table__n">{group.attempts}</td>
            <td className="admin-table__n">{group.accepted}</td>
            <td className="admin-table__n">{group.rejected}</td>
            <td className="admin-table__n">{group.pending}</td>
            <td className="admin-table__n">{group.discarded}</td>
            <td className="admin-table__n">
              {group.technicalFailures} ({formatRate(group.failureRate)})
            </td>
            <td className="admin-table__n">
              {formatUsd(group.averageCostUsd)}
            </td>
            <td className="admin-table__n">{formatUsd(group.totalCostUsd)}</td>
            <td className="admin-table__n">
              {formatMs(group.averageLatencyMs)}
            </td>
          </tr>
          <AdminTableDetail>
            <p>
              {group.servedProvider ?? 'provider inconnu'} · prompt{' '}
              {group.promptVersion}
              {group.failureKinds.length > 0 &&
                ` · ${group.failureKinds
                  .map(({ kind, count }) => `${kind} ${count}`)
                  .join(', ')}`}
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
          </AdminTableDetail>
        </tbody>
      ))}
      <tfoot>
        <tr>
          <th scope="row">{formatCount(rows.length, 'configuration')}</th>
          <td className="admin-table__n">{totals.attempts}</td>
          <td className="admin-table__n">{totals.accepted}</td>
          <td className="admin-table__n">{totals.rejected}</td>
          <td className="admin-table__n">{totals.pending}</td>
          <td className="admin-table__n">{totals.discarded}</td>
          <td className="admin-table__n">
            {totals.technicalFailures} ({formatRate(totals.failureRate)})
          </td>
          <td className="admin-table__n">{formatUsd(totals.averageCostUsd)}</td>
          <td className="admin-table__n">{formatUsd(totals.totalCostUsd)}</td>
          <td className="admin-table__n">
            {formatMs(totals.averageLatencyMs)}
          </td>
        </tr>
      </tfoot>
    </AdminTable>
  )
}
