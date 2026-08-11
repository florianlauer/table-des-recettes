import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { compressImage } from '../lib/compress'
import { MAX_ATTEMPTS } from '../lib/queueContract'
import {
  applyClockOffset,
  formatAge,
  formatRemaining,
  isLeaseLive,
  isQueueStopped,
  queueButtonState,
} from '../lib/queueStatus'

export const ADMIN_TOKEN_STORAGE_KEY = 'table-des-recettes-admin-token'

export const Route = createFileRoute('/admin')({ component: AdminPage })

function AdminPage() {
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const createScan = useMutation(api.admin.createScan)
  const purgeScanImages = useMutation(api.admin.purgeScanImages)
  const serverTime = useMutation(api.admin.serverTime)
  const [clockOffset, setClockOffset] = useState(0)
  const [clientNow, setClientNow] = useState(() => Date.now())
  const scans = useQuery({
    ...convexQuery(api.admin.listScans, { adminToken }),
    enabled: adminToken.length > 0,
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

  const now = applyClockOffset({ clientNow, offsetMs: clockOffset })

  function updateToken(value: string) {
    setAdminToken(value)
    if (value) sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value)
    else sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  }

  async function upload(file: File) {
    setBusy(true)
    setMessage('Compression en cours…')
    try {
      const compressed = await compressImage(file)
      if (!compressed.ok) {
        setMessage(compressed.message)
        return
      }
      const grant = await generateUploadUrl({ adminToken })
      if (!grant.ok) {
        setMessage(`${grant.error} (${Math.ceil(grant.retryAfter / 1000)} s)`)
        return
      }
      const response = await fetch(grant.uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: compressed.blob,
      })
      if (!response.ok)
        throw new Error(`Téléversement refusé (HTTP ${response.status})`)
      const uploaded = (await response.json()) as { storageId: string }
      const result = await createScan({
        adminToken,
        ticketId: grant.ticketId,
        storageId: uploaded.storageId as Id<'_storage'>,
      })
      setMessage(result.ok ? 'Scan créé.' : result.error)
      if (result.ok) await scans.refetch()
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
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
          disabled={!adminToken || busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </label>

      <QueueBlock adminToken={adminToken} now={now} onMessage={setMessage} />

      {message && <p role="status">{message}</p>}
      {scans.error && <p role="alert">{scans.error.message}</p>}

      <section className="admin-page__scans">
        <h2>Scans</h2>
        {scans.isLoading && adminToken && <p>Chargement…</p>}
        {scans.data?.map((scan) => (
          <article key={scan.id} className="admin-page__scan">
            <h3>{scan.status}</h3>
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
                startedAt: scan.startedAt,
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
    </main>
  )
}

function QueueBlock({
  adminToken,
  now,
  onMessage,
}: {
  adminToken: string
  now: number
  onMessage: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const startExtraction = useMutation(api.admin.startExtraction)
  const queue = useQuery({
    ...convexQuery(api.admin.queueStatus, { adminToken }),
    enabled: adminToken.length > 0,
    retry: false,
  })
  const status = queue.data
  const button = queueButtonState({
    pendingCount: status?.counts.pending ?? 0,
    leaseStartedAt: status?.currentLease?.startedAt ?? null,
    nextAttemptAt: status?.nextAttemptAt ?? null,
    retryAt,
    now,
  })
  const stopped = status
    ? isQueueStopped({
        pendingCount: status.counts.pending,
        leaseStartedAt: status.currentLease?.startedAt ?? null,
        nextAttemptAt: status.nextAttemptAt,
        now,
      })
    : false

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
              Bail{' '}
              {isLeaseLive({
                startedAt: status.currentLease.startedAt,
                now,
              })
                ? 'actif'
                : 'périmé'}{' '}
              depuis{' '}
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
          setBusy(true)
          startExtraction({ adminToken })
            .then((result) => {
              if (result.status === 'scheduled') {
                setRetryAt(null)
                onMessage('Extraction planifiée.')
              } else if (result.status === 'already_running') {
                onMessage('Une extraction est déjà en cours.')
              } else if (result.status === 'no_work') {
                onMessage('Rien à extraire.')
              } else {
                setRetryAt(result.retryAt)
                onMessage(
                  `Limite atteinte. Reprise possible dans ${formatRemaining({ deadline: result.retryAt, now })}.`,
                )
              }
            })
            .catch((error: unknown) =>
              onMessage(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setBusy(false))
        }}
      >
        {button.label}
      </button>
    </section>
  )
}
