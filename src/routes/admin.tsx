import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { adminTokenState, useAdminToken } from '../lib/adminToken'
import { attemptTotals, groupKey } from '../lib/attemptStats'
import type { WireAttemptSummary } from '../lib/attemptStats'
import { estimateFrom } from '../lib/estimate'
import { formatCount } from '../lib/formatCount'
import { formatMs, formatRate, formatUsd } from '../lib/formatNumber'
import {
  extractionMessage,
  purgeMessage,
  uploadMessage,
} from '../lib/gestureMessages'
import { isolatedGesture, pageGesture, rowGesture } from '../lib/gestures'
import { MAX_ATTEMPTS } from '../lib/queueContract'
import { scanNotes } from '../lib/scanNotes'
import { formatScanLabel, scanStatusLabel } from '../lib/scanLabel'
import { useAttachImage } from '../lib/useAttachImage'
import { useGestures } from '../lib/useGestures'
import type { Gestures } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { uploadProgress } from '../lib/uploadProgress'
import {
  deriveQueueState,
  formatAge,
  formatRemaining,
  isLeaseLive,
} from '../lib/queueStatus'
import { adminHead } from './-adminHead'
import { AdminButton } from './-AdminButton'
import { AdminFailure } from './-AdminFailure'
import { AdminFileInput } from './-AdminFileInput'
import { GestureProgress } from './-GestureProgress'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
  head: adminHead,
})

function AdminPage() {
  const { token, save: updateToken } = useAdminToken()
  const [revealToken, setRevealToken] = useState(false)
  const tokenAbsent = adminTokenState(token) === 'absent'
  const adminToken = token ?? ''
  const attachImage = useAttachImage(adminToken)
  const purgeScanImages = useMutation(api.admin.purgeScanImages)
  const gestures = useGestures({ epoch: `admin:${adminToken}` })
  const { now } = useServerClock(adminToken)

  const scans = useQuery({
    ...convexQuery(api.admin.listScans, adminToken ? { adminToken } : 'skip'),
    retry: false,
  })
  // Hoisted out of the statistics block: the same journal that reports what calls cost is what says
  // how long they usually take, and the bar under the queue reads it.
  const stats = useQuery({
    ...convexQuery(
      api.admin.attemptStats,
      adminToken ? { adminToken } : 'skip',
    ),
    retry: false,
  })
  const extractionEstimateMs = estimateFrom(stats.data ?? [])

  // One scan per file. Selecting thirty pages at once is how the initial backlog gets in, and those
  // pages have nothing to do with each other — grouping them would make one huge billed call.
  // Pages that belong together are grouped from the correction screen instead.
  const capture = isolatedGesture('capture', 'upload')

  return (
    <main className="page admin-page">
      <header className="admin-page__header">
        <h1>Administration</h1>
        {/* The way out was missing: /admin is reached by typing the path, and nothing on it led back
            to the site it administers. */}
        <p>
          <Link to="/admin/illustrations">Photos des plats</Link> ·{' '}
          <Link to="/">Voir le site</Link>
        </p>
      </header>

      {/* Sixty characters typed on a phone, masked, with a refusal as the only feedback: the reveal
          is what lets the operator check the token instead of retyping it. */}
      <div className="admin-page__token">
        <label className="admin-page__field">
          Jeton administrateur
          <input
            type={revealToken ? 'text' : 'password'}
            value={adminToken}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => updateToken(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => setRevealToken(!revealToken)}>
          {revealToken ? 'Masquer' : 'Afficher'}
        </button>
      </div>

      <AdminFileInput
        gestures={gestures}
        gesture={capture}
        label="Photographier une page"
        pendingLabel="Envoi…"
        multiple
        disabled={!adminToken}
        onFiles={async (files, report) => {
          const failures: string[] = []
          for (const [index, file] of files.entries()) {
            const result = await attachImage(file, {
              onPhase: (phase) =>
                report(
                  uploadProgress({ done: index, total: files.length, phase }),
                ),
            })
            if (!result.ok) failures.push(`${file.name} : ${result.error}`)
          }
          await scans.refetch()
          return uploadMessage({ total: files.length, failures })
        }}
      />

      <QueueBlock
        adminToken={adminToken}
        tokenAbsent={tokenAbsent}
        now={now}
        gestures={gestures}
        estimateMs={extractionEstimateMs}
      />

      <section className="admin-page__scans">
        <h2>Scans</h2>
        {/* Three states, not one silence. An operator with no token and an operator with an empty
            queue used to see exactly the same page: a heading above nothing. */}
        {tokenAbsent && (
          <p className="empty">
            Saisis le jeton administrateur pour afficher les scans.
          </p>
        )}
        {scans.isLoading && adminToken && <p>Chargement…</p>}
        {scans.error && (
          <AdminFailure
            error={scans.error}
            retry={() => void scans.refetch()}
          />
        )}
        {scans.data?.length === 0 && <p className="empty">Aucun scan.</p>}
        {/*
          A table, because the question asked of this list is a comparison: which page has attempts
          left, which one is stuck, how many drafts came out of each. Stacked paragraphs answered one
          scan at a time. Everything that is not a column — the failure, the drafts, the last call —
          rides in a detail row spanning the table, so nothing is dropped to fit a grid.
        */}
        {scans.data && scans.data.length > 0 && (
          <div className="admin-table__scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col" className="admin-table__n">
                    Images
                  </th>
                  <th scope="col" className="admin-table__n">
                    Brouillons
                  </th>
                  <th scope="col">État</th>
                  <th scope="col" className="admin-table__n">
                    Tentatives
                  </th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              {scans.data.map((scan) => {
                const purge = rowGesture(scan.id, 'purge')
                const leaseLive = isLeaseLive({
                  leaseStartedAt: scan.leaseStartedAt,
                  now,
                })
                const notes = scanNotes({ scan, now })
                return (
                  // One `tbody` per scan rather than one per table: it is what carries `data-row-id`
                  // for the gesture registry — `closest()` finds it from the button — and it keeps a
                  // row and its detail line in the same group.
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
                                await purgeScanImages({
                                  adminToken,
                                  scanId: scan.id,
                                }),
                              )
                            }
                          />
                        )}
                      </td>
                    </tr>
                    {(notes.length > 0 ||
                      (leaseLive && scan.leaseStartedAt !== null)) && (
                      <tr className="admin-table__detail">
                        <td colSpan={6}>
                          {notes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                          {leaseLive && scan.leaseStartedAt !== null && (
                            <GestureProgress
                              startedAt={scan.leaseStartedAt}
                              estimateMs={extractionEstimateMs}
                              token={scan.leaseStartedAt}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
      </section>

      <AttemptStatsBlock
        groups={stats.data}
        tokenAbsent={tokenAbsent}
        loading={stats.isLoading && adminToken.length > 0}
        error={stats.error}
        retry={() => void stats.refetch()}
      />
    </main>
  )
}

function AttemptStatsBlock({
  groups,
  tokenAbsent,
  loading,
  error,
  retry,
}: {
  groups: WireAttemptSummary[] | undefined
  tokenAbsent: boolean
  loading: boolean
  error: Error | null
  retry: () => void
}) {
  const totals = attemptTotals(groups ?? [])

  return (
    <section className="admin-page__stats">
      <h2>Tentatives d’extraction</h2>
      {/* `=== 0` alone never fired: a failed query leaves `groups` undefined, not empty, so the
          heading floated above nothing on the very state that needed explaining. */}
      {tokenAbsent && (
        <p className="empty">
          Saisis le jeton administrateur pour afficher le journal.
        </p>
      )}
      {loading && <p>Chargement…</p>}
      {error && <AdminFailure error={error} retry={retry} />}
      {groups?.length === 0 && (
        <p className="empty">Aucune tentative journalisée.</p>
      )}
      {/*
        The whole point of this journal is a comparison — is the cheap model still cheaper once its
        failures are paid for — and stacked prose made every figure a separate reading. Columns, and a
        totals row weighted by attempts.
      */}
      {groups && groups.length > 0 && (
        <div className="admin-table__scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Modèle</th>
                <th scope="col" className="admin-table__n">
                  Tentatives
                </th>
                <th scope="col" className="admin-table__n">
                  Échecs
                </th>
                <th scope="col" className="admin-table__n">
                  Coût moyen
                </th>
                <th scope="col" className="admin-table__n">
                  Coût total
                </th>
                <th scope="col" className="admin-table__n">
                  Durée moyenne
                </th>
                <th scope="col" className="admin-table__n">
                  Réparations
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={groupKey(group)}>
                <tr>
                  <th scope="row">
                    {group.model}
                    {group.isCurrent && (
                      <span className="admin-table__flag"> en service</span>
                    )}
                  </th>
                  <td className="admin-table__n">{group.attempts}</td>
                  <td className="admin-table__n">
                    {group.failures} ({formatRate(group.failureRate)})
                  </td>
                  <td className="admin-table__n">
                    {formatUsd(group.averageCostUsd)}
                  </td>
                  <td className="admin-table__n">
                    {formatUsd(group.totalCostUsd)}
                  </td>
                  <td className="admin-table__n">
                    {formatMs(group.averageLatencyMs)}
                  </td>
                  <td className="admin-table__n">
                    {group.repairs} / {group.repairedAttempts}
                  </td>
                </tr>
                {/* The identity of a reading is four things, not one: two of them would make the
                    model column unreadable, so they ride under it. */}
                <tr className="admin-table__detail">
                  <td colSpan={7}>
                    <p>
                      {group.servedProvider ?? 'provider inconnu'} · prompt{' '}
                      {group.promptVersion} · schéma {group.schemaVersion}
                      {group.failureKinds.length > 0 &&
                        ` · ${group.failureKinds
                          .map(({ kind, count }) => `${kind} ${count}`)
                          .join(', ')}`}
                    </p>
                  </td>
                </tr>
              </tbody>
            ))}
            {totals && (
              <tfoot>
                <tr>
                  <th scope="row">{formatCount(groups.length, 'lecture')}</th>
                  <td className="admin-table__n">{totals.attempts}</td>
                  <td className="admin-table__n">
                    {totals.failures} ({formatRate(totals.failureRate)})
                  </td>
                  <td className="admin-table__n">
                    {formatUsd(totals.averageCostUsd)}
                  </td>
                  <td className="admin-table__n">
                    {formatUsd(totals.totalCostUsd)}
                  </td>
                  <td className="admin-table__n">
                    {formatMs(totals.averageLatencyMs)}
                  </td>
                  <td className="admin-table__n">{totals.repairs}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  )
}

function QueueBlock({
  adminToken,
  tokenAbsent,
  now,
  gestures,
  estimateMs,
}: {
  adminToken: string
  tokenAbsent: boolean
  now: number
  gestures: Gestures
  estimateMs: number | null
}) {
  const startExtraction = useMutation(api.admin.startExtraction)
  const queue = useQuery({
    ...convexQuery(api.admin.queueStatus, adminToken ? { adminToken } : 'skip'),
    retry: false,
  })
  const status = queue.data
  const { leaseLive, stopped, button } = deriveQueueState({
    facts: {
      pendingCount: status?.counts.pending ?? 0,
      leaseStartedAt: status?.currentLease?.startedAt ?? null,
      nextAttemptAt: status?.nextAttemptAt ?? null,
    },
    now,
  })

  return (
    <section className="admin-page__queue">
      <h2>File d’extraction</h2>
      {tokenAbsent && (
        <p className="empty">
          Saisis le jeton administrateur pour piloter la file.
        </p>
      )}
      {queue.isLoading && adminToken && <p>Chargement…</p>}
      {queue.error && (
        <AdminFailure error={queue.error} retry={() => void queue.refetch()} />
      )}
      {status && (
        <>
          {/*
            One typographic line of counts, the way the index sets its filters, instead of five
            paragraphs each holding one number. Five separate lines could not be compared; a row of
            tabular figures can.
          */}
          <p className="admin-page__counts">
            <span>
              En attente <b>{status.counts.pending}</b>
            </span>
            <span>
              En cours <b>{status.counts.extracting}</b>
            </span>
            <span>
              Terminés <b>{status.counts.done}</b>
            </span>
            <span>
              En échec <b>{status.counts.failed}</b>
            </span>
            <span>
              Au plafond <b>{status.attemptsCeiling}</b>
            </span>
          </p>
          {status.truncated && <p>Comptages plafonnés à 1000.</p>}
          {status.oldestPendingAt !== null && (
            <p>
              Plus ancien en attente :{' '}
              {formatAge({ timestamp: status.oldestPendingAt, now })}
            </p>
          )}
          {status.currentLease && (
            <p>
              Bail {leaseLive ? 'actif' : 'périmé'} depuis{' '}
              {formatAge({ timestamp: status.currentLease.startedAt, now })} ·
              tentative {status.currentLease.attempts} / {MAX_ATTEMPTS}
            </p>
          )}
          {/* The real wait is here, not in the click: pressing the button schedules and returns. */}
          {leaseLive && status.currentLease && (
            <GestureProgress
              startedAt={status.currentLease.startedAt}
              estimateMs={estimateMs}
              token={status.currentLease.startedAt}
            />
          )}
          {status.nextAttemptAt !== null && status.nextAttemptAt > now && (
            <p>
              Reprise programmée dans{' '}
              {formatRemaining({ deadline: status.nextAttemptAt, now })}.
            </p>
          )}
          {stopped && <p>File à l’arrêt.</p>}
        </>
      )}
      <AdminButton
        gestures={gestures}
        gesture={pageGesture('extract')}
        label={button.label}
        pendingLabel="Relance…"
        disabled={!adminToken || button.disabled}
        run={async () =>
          extractionMessage(await startExtraction({ adminToken }), { now })
        }
      />
    </section>
  )
}
