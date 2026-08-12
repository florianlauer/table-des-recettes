import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { groupKey } from '../lib/attemptStats'
import { MAX_ATTEMPTS } from '../lib/queueContract'
import { useAttachImage } from '../lib/useAttachImage'
import {
  deriveQueueState,
  formatAge,
  formatRemaining,
  isLeaseLive,
} from '../lib/queueStatus'

export const ADMIN_TOKEN_STORAGE_KEY = 'table-des-recettes-admin-token'

export const Route = createFileRoute('/admin')({ component: AdminPage })

function AdminPage() {
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const attachImage = useAttachImage(adminToken)
  const purgeScanImages = useMutation(api.admin.purgeScanImages)
  const serverTime = useMutation(api.admin.serverTime)
  const [clockOffset, setClockOffset] = useState(0)
  const [clientNow, setClientNow] = useState(() => Date.now())
  const scans = useQuery({
    ...convexQuery(api.admin.listScans, adminToken ? { adminToken } : 'skip'),
    retry: false,
  })

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!adminToken) return
    void serverTime({ adminToken })
      .then((now) => {
        setClockOffset(now - Date.now())
        setClientNow(Date.now())
      })
      .catch(() => undefined)
  }, [adminToken, serverTime])

  const now = clientNow + clockOffset

  function updateToken(value: string) {
    setAdminToken(value)
    if (value) sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value)
    else sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  }

  // One scan per file. Selecting thirty pages at once is how the initial backlog gets in, and those
  // pages have nothing to do with each other — grouping them would make one huge billed call.
  // Pages that belong together are grouped from the correction screen instead.
  async function upload(files: File[]) {
    setBusy(true)
    setMessage(
      files.length > 1 ? `Envoi de ${files.length} pages…` : 'Compression…',
    )
    try {
      const failures: string[] = []
      for (const file of files) {
        const result = await attachImage(file)
        if (!result.ok) failures.push(`${file.name} : ${result.error}`)
      }
      setMessage(
        failures.length === 0
          ? `${files.length} scan(s) créé(s).`
          : failures.join(' · '),
      )
      await scans.refetch()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

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

      <label className="admin-page__field">
        Photographier une page
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
          disabled={!adminToken || busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            if (files.length > 0) void upload(files)
          }}
        />
      </label>

      <QueueBlock
        adminToken={adminToken}
        now={now}
        busy={busy}
        onBusy={setBusy}
        onMessage={setMessage}
      />

      {message && <p role="status">{message}</p>}
      {scans.error && <p role="alert">{scans.error.message}</p>}

      <section className="admin-page__scans">
        <h2>Scans</h2>
        {scans.isLoading && adminToken && <p>Chargement…</p>}
        {scans.data?.map((scan) => (
          <article key={scan.id} className="admin-page__scan">
            <h3>
              <Link to="/admin/scan/$id" params={{ id: scan.id }}>
                {scan.status}
              </Link>
            </h3>
            <p>
              {scan.imageCount} image · {scan.drafts.length}
              {scan.draftsTruncated ? '+' : ''} brouillon(s)
            </p>
            <p>
              Tentatives : {scan.attempts} / {MAX_ATTEMPTS}
            </p>
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
            {scan.purgedAt === null &&
              !isLeaseLive({
                leaseStartedAt: scan.leaseStartedAt,
                now,
              }) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Purger définitivement cette photo ?'))
                      return
                    setBusy(true)
                    purgeScanImages({ adminToken, scanId: scan.id })
                      .then((result) => {
                        setMessage(
                          result === 'purged'
                            ? 'Photo purgée.'
                            : result === 'deferred'
                              ? 'Purge reportée : une extraction est en cours.'
                              : 'Photo déjà purgée.',
                        )
                      })
                      .catch((error: unknown) =>
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        ),
                      )
                      .finally(() => setBusy(false))
                  }}
                >
                  Purger la photo
                </button>
              )}
          </article>
        ))}
      </section>

      <AttemptStatsBlock adminToken={adminToken} />
    </main>
  )
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.01 ? 1 : 0)} %`
}

function AttemptStatsBlock({ adminToken }: { adminToken: string }) {
  const stats = useQuery({
    ...convexQuery(
      api.admin.attemptStats,
      adminToken ? { adminToken } : 'skip',
    ),
    retry: false,
  })

  return (
    <section className="admin-page__stats">
      <h2>Tentatives d’extraction</h2>
      {stats.isLoading && adminToken && <p>Chargement…</p>}
      {stats.error && <p role="alert">{stats.error.message}</p>}
      {stats.data?.length === 0 && <p>Aucune tentative journalisée.</p>}
      {stats.data?.map((group) => (
        <article key={groupKey(group)} className="admin-page__stat">
          <h3>
            {group.model} · prompt {group.promptVersion} · schéma{' '}
            {group.schemaVersion}
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
  now,
  busy,
  onBusy,
  onMessage,
}: {
  adminToken: string
  now: number
  busy: boolean
  onBusy: (busy: boolean) => void
  onMessage: (message: string) => void
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
      {queue.isLoading && adminToken && <p>Chargement…</p>}
      {queue.error && <p role="alert">{queue.error.message}</p>}
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
          {status.nextAttemptAt !== null && status.nextAttemptAt > now && (
            <p>
              Reprise programmée dans{' '}
              {formatRemaining({ deadline: status.nextAttemptAt, now })}.
            </p>
          )}
          {stopped && <p>File à l'arrêt.</p>}
        </>
      )}
      <button
        type="button"
        disabled={!adminToken || busy || button.disabled}
        onClick={() => {
          onBusy(true)
          startExtraction({ adminToken })
            .then((result) => {
              if (result.status === 'scheduled') {
                onMessage('Extraction planifiée.')
              } else if (result.status === 'already_running') {
                onMessage('Une extraction est déjà en cours.')
              } else if (result.status === 'no_work') {
                onMessage('Rien à extraire.')
              } else {
                onMessage(
                  `Limite atteinte. Reprise possible dans ${formatRemaining({ deadline: result.retryAt, now })}.`,
                )
              }
            })
            .catch((error: unknown) =>
              onMessage(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => onBusy(false))
        }}
      >
        {button.label}
      </button>
    </section>
  )
}
