import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { adminTokenState, useAdminToken } from '../lib/adminToken'
import { dataView } from '../lib/dataView'
import { estimateFrom } from '../lib/estimate'
import { extractionMessage, uploadMessage } from '../lib/gestureMessages'
import { isolatedGesture, pageGesture } from '../lib/gestures'
import { nonEmpty } from '../lib/journalStats'
import { MAX_ATTEMPTS } from '../lib/queueContract'
import {
  deriveQueueState,
  formatAge,
  formatRemaining,
} from '../lib/queueStatus'
import { useAttachImage } from '../lib/useAttachImage'
import { useGestures } from '../lib/useGestures'
import type { Gestures } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { uploadProgress } from '../lib/uploadProgress'
import { adminHead } from './-adminHead'
import { AdminButton } from './-AdminButton'
import { AdminFileInput } from './-AdminFileInput'
import { AdminSectionState } from './-AdminSectionState'
import { AttemptStatsTable } from './-AttemptStats'
import { GestureProgress } from './-GestureProgress'
import { ScanTable } from './-ScanTable'

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

  // One value per query rather than a ladder of booleans per block: `dataView` decides what the
  // section is looking at, and only the `ready` case carries data at all.
  const scansView = dataView({
    tokenAbsent,
    loading: scans.isLoading,
    error: scans.error,
    data: scans.data,
  })
  const scanRows = scansView.kind === 'ready' ? nonEmpty(scansView.data) : null
  const statsView = dataView({
    tokenAbsent,
    loading: stats.isLoading,
    error: stats.error,
    data: stats.data,
  })
  const statsRows = statsView.kind === 'ready' ? nonEmpty(statsView.data) : null

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
        <AdminSectionState
          view={scansView}
          absent="Saisis le jeton administrateur pour afficher les scans."
          retry={() => void scans.refetch()}
        />
        {scansView.kind === 'ready' &&
          (scanRows ? (
            <ScanTable
              rows={scanRows}
              adminToken={adminToken}
              gestures={gestures}
              now={now}
              estimateMs={extractionEstimateMs}
            />
          ) : (
            <p className="empty">Aucun scan.</p>
          ))}
      </section>

      <section className="admin-page__stats">
        <h2>Tentatives d’extraction</h2>
        <AdminSectionState
          view={statsView}
          absent="Saisis le jeton administrateur pour afficher le journal."
          retry={() => void stats.refetch()}
        />
        {statsView.kind === 'ready' &&
          (statsRows ? (
            <AttemptStatsTable rows={statsRows} />
          ) : (
            <p className="empty">Aucune tentative journalisée.</p>
          ))}
      </section>
    </main>
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
  const view = dataView({
    tokenAbsent,
    loading: queue.isLoading,
    error: queue.error,
    data: queue.data,
  })
  const status = view.kind === 'ready' ? view.data : null
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
      <AdminSectionState
        view={view}
        absent="Saisis le jeton administrateur pour piloter la file."
        retry={() => void queue.refetch()}
      />
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
