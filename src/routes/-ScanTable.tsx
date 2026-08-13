import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { purgeMessage } from '../lib/gestureMessages'
import { rowGesture } from '../lib/gestures'
import { MAX_ATTEMPTS } from '../lib/queueContract'
import { isLeaseLive } from '../lib/queueStatus'
import { formatScanLabel, scanStatusLabel } from '../lib/scanLabel'
import { scanNotes } from '../lib/scanNotes'
import type { NonEmpty } from '../lib/journalStats'
import type { Gestures } from '../lib/useGestures'
import { AdminButton } from './-AdminButton'
import { AdminTable, AdminTableDetail } from './-AdminTable'
import { GestureProgress } from './-GestureProgress'

/** Read off the server rather than retyped, so a change to the query lands here at compile time. */
export type Scan = (typeof api.admin.listScans)['_returnType'][number]

const COLUMNS = [
  { label: 'Page' },
  { label: 'Images', numeric: true },
  { label: 'Brouillons', numeric: true },
  { label: 'État' },
  { label: 'Tentatives', numeric: true },
  { label: 'Action' },
] as const

/**
 * The scans, in columns, because the question asked of this list is a comparison: which page has
 * attempts left, which one is stuck, how many drafts came out of each. Stacked paragraphs answered one
 * scan at a time.
 */
export function ScanTable({
  rows,
  adminToken,
  gestures,
  now,
  estimateMs,
}: {
  rows: NonEmpty<Scan>
  adminToken: string
  gestures: Gestures
  now: number
  estimateMs: number | null
}) {
  const purgeScanImages = useMutation(api.admin.purgeScanImages)

  return (
    <AdminTable columns={COLUMNS}>
      {rows.map((scan) => {
        const purge = rowGesture(scan.id, 'purge')
        const leaseLive = isLeaseLive({
          leaseStartedAt: scan.leaseStartedAt,
          now,
        })
        const notes = scanNotes({ scan, now })
        return (
          // One `tbody` per scan rather than one per table: it is what carries `data-row-id` for the
          // gesture registry — `closest()` finds it from the button — and it keeps a row and its
          // detail line in the same group.
          <tbody
            key={scan.id}
            data-row-id={scan.id}
            aria-busy={gestures.running(purge) !== null}
          >
            <tr>
              <th scope="row">
                <Link to="/admin/scan/$id" params={{ id: scan.id }}>
                  {formatScanLabel(scan.createdAt)}
                </Link>
              </th>
              <td className="admin-table__n">{scan.imageCount}</td>
              <td className="admin-table__n">
                {scan.drafts.length}
                {scan.draftsTruncated && '+'}
              </td>
              <td>{scanStatusLabel(scan.status)}</td>
              <td className="admin-table__n">
                {scan.attempts} / {MAX_ATTEMPTS}
              </td>
              <td>
                {scan.purgedAt === null && !leaseLive && (
                  <AdminButton
                    gestures={gestures}
                    gesture={purge}
                    label="Purger la photo"
                    pendingLabel="Purge…"
                    confirm="Purger définitivement cette photo ?"
                    run={async () =>
                      purgeMessage(
                        await purgeScanImages({ adminToken, scanId: scan.id }),
                      )
                    }
                  />
                )}
              </td>
            </tr>
            {(notes.length > 0 ||
              (leaseLive && scan.leaseStartedAt !== null)) && (
              <AdminTableDetail>
                {/* Keyed by position: the notes are a fixed ordered set from a pure function, and two
                    of them can hold the same text. */}
                {notes.map((note, index) => (
                  <p key={index}>{note}</p>
                ))}
                {leaseLive && scan.leaseStartedAt !== null && (
                  <GestureProgress
                    startedAt={scan.leaseStartedAt}
                    estimateMs={estimateMs}
                    token={scan.leaseStartedAt}
                  />
                )}
              </AdminTableDetail>
            )}
          </tbody>
        )
      })}
    </AdminTable>
  )
}
