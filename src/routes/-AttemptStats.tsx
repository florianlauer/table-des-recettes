import { attemptTotals, groupKey } from '../shared/attemptStats'
import { formatCount } from '../lib/formatCount'
import { formatMs, formatRate, formatUsd } from '../lib/formatNumber'
import type { WireAttemptSummary } from '../shared/attemptStats'
import type { NonEmpty } from '../shared/journalStats'
import { AdminTable, AdminTableDetail } from './-AdminTable'
import { JournalIdentityLine, JournalModelCell } from './-JournalCells'

const COLUMNS = [
  { label: 'Modèle' },
  { label: 'Tentatives', numeric: true },
  { label: 'Échecs', numeric: true },
  { label: 'Coût moyen', numeric: true },
  { label: 'Coût total', numeric: true },
  { label: 'Durée moyenne', numeric: true },
  { label: 'Réparations', numeric: true },
] as const

/**
 * What the extraction calls have cost and how they have landed. The whole point of this journal is a
 * comparison — is the cheap model still cheaper once its failures are paid for — and stacked prose
 * made every figure a separate reading.
 */
export function AttemptStatsTable({
  rows,
}: {
  rows: NonEmpty<WireAttemptSummary>
}) {
  const totals = attemptTotals(rows)

  return (
    <AdminTable columns={COLUMNS}>
      {rows.map((group) => (
        <tbody key={groupKey(group)}>
          <tr>
            <JournalModelCell model={group.model} isCurrent={group.isCurrent} />
            <td className="admin-table__n">{group.attempts}</td>
            <td className="admin-table__n">
              {group.failures} ({formatRate(group.failureRate)})
            </td>
            <td className="admin-table__n">
              {formatUsd(group.averageCostUsd)}
            </td>
            <td className="admin-table__n">{formatUsd(group.totalCostUsd)}</td>
            <td className="admin-table__n">
              {formatMs(group.averageLatencyMs)}
            </td>
            <td className="admin-table__n">
              {group.repairs} / {group.repairedAttempts}
            </td>
          </tr>
          <AdminTableDetail>
            <JournalIdentityLine {...group} />
          </AdminTableDetail>
        </tbody>
      ))}
      <tfoot>
        <tr>
          <th scope="row">{formatCount(rows.length, 'lecture')}</th>
          <td className="admin-table__n">{totals.attempts}</td>
          <td className="admin-table__n">
            {totals.failures} ({formatRate(totals.failureRate)})
          </td>
          <td className="admin-table__n">{formatUsd(totals.averageCostUsd)}</td>
          <td className="admin-table__n">{formatUsd(totals.totalCostUsd)}</td>
          <td className="admin-table__n">
            {formatMs(totals.averageLatencyMs)}
          </td>
          <td className="admin-table__n">{totals.repairs}</td>
        </tr>
      </tfoot>
    </AdminTable>
  )
}
