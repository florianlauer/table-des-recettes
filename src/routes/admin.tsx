import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { adminTokenState, useAdminToken } from '../lib/adminToken'
import { groupKey } from '../lib/attemptStats'
import type { WireAttemptSummary } from '../lib/attemptStats'
import { estimateFrom } from '../lib/estimate'
import {
  extractionMessage,
  purgeMessage,
  uploadMessage,
} from '../lib/gestureMessages'
import { isolatedGesture, pageGesture, rowGesture } from '../lib/gestures'
import { MAX_ATTEMPTS } from '../lib/queueContract'
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
import { AdminButton } from './-AdminButton'
import { AdminFailure } from './-AdminFailure'
import { AdminFileInput } from './-AdminFileInput'
import { GestureProgress } from './-GestureProgress'

export const Route = createFileRoute('/admin')({ component: AdminPage })

function AdminPage() {
  const { token, save: updateToken } = useAdminToken()
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
        <p>
          <Link to="/admin/illustrations">Photos des plats</Link>
        </p>
      </header>

      <label className="admin-page__field">
        Jeton administrateur
        <input
          type="password"
          value={adminToken}
          autoComplete="off"
          onChange={(event) => updateToken(event.target.value)}
        />
      </label>

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
        {scans.data?.map((scan) => {
          const purge = rowGesture(scan.id, 'purge')
          const leaseLive = isLeaseLive({
            leaseStartedAt: scan.leaseStartedAt,
            now,
          })
          return (
            <article
              key={scan.id}
              className="admin-page__scan"
              data-row-id={scan.id}
              aria-busy={gestures.running(purge) !== null}
            >
              <h3>
                <Link to="/admin/scan/$id" params={{ id: scan.id }}>
                  {formatScanLabel(scan.createdAt)}
                </Link>
              </h3>
              <p>
                {scan.imageCount} image · {scan.drafts.length}
                {scan.draftsTruncated ? '+' : ''} brouillon(s) ·{' '}
                {scanStatusLabel(scan.status)}
              </p>
              {scan.drafts.length > 0 && (
                <p className="admin-page__drafts">
                  {scan.drafts
                    .map((draft) => draft.title || 'sans titre')
                    .join(' · ')}
                </p>
              )}
              <p>
                Tentatives : {scan.attempts} / {MAX_ATTEMPTS}
              </p>
              {leaseLive && scan.leaseStartedAt !== null && (
                <GestureProgress
                  startedAt={scan.leaseStartedAt}
                  estimateMs={extractionEstimateMs}
                  token={scan.leaseStartedAt}
                />
              )}
              {scan.purgedAt !== null && (
                <p>
                  Photo purgée il y a{' '}
                  {formatAge({ timestamp: scan.purgedAt, now })}.
                </p>
              )}
              {scan.draftsTruncated && (
                <p>
                  Plus de {scan.drafts.length} brouillons : extraction
                  probablement défectueuse.
                </p>
              )}
              {scan.error && <p>Échec : {scan.error}</p>}
              {scan.drafts.some((draft) => draft.ingredientsInferred) && (
                <p>Ingrédients déduits à vérifier.</p>
              )}
              {scan.lastAttempt && (
                <p>
                  {scan.lastAttempt.model} ·{' '}
                  {scan.lastAttempt.servedProvider ?? 'provider inconnu'} ·{' '}
                  {Math.round(scan.lastAttempt.latencyMs)} ms ·{' '}
                  {scan.lastAttempt.costUsd.toFixed(4)} USD ·{' '}
                  {scan.lastAttempt.failureKind ?? 'succès'} ·{' '}
                  {scan.lastAttempt.repairCount} réparation(s)
                </p>
              )}
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
            </article>
          )
        })}
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

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.01 ? 1 : 0)} %`
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
      {groups?.map((group) => (
        <article key={groupKey(group)} className="admin-page__stat">
          <h3>
            {group.model} · {group.servedProvider ?? 'provider inconnu'} ·
            prompt {group.promptVersion} · schéma {group.schemaVersion}
            {group.isCurrent && ' · en service'}
          </h3>
          <p>
            {group.attempts} tentative(s) · {group.failures} échec(s) (
            {formatRate(group.failureRate)})
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
          <p>
            {group.repairs} réparation(s) de schéma sur {group.repairedAttempts}{' '}
            tentative(s)
          </p>
        </article>
      ))}
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
      <h2>File d'extraction</h2>
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
          <p>En attente : {status.counts.pending}</p>
          <p>En cours : {status.counts.extracting}</p>
          <p>Terminés : {status.counts.done}</p>
          <p>En échec : {status.counts.failed}</p>
          <p>Au plafond de tentatives : {status.attemptsCeiling}</p>
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
          {stopped && <p>File à l'arrêt.</p>}
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
