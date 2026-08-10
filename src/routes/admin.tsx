import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { compressImage } from '../lib/compress'

export const ADMIN_TOKEN_STORAGE_KEY = 'table-des-recettes-admin-token'

export const Route = createFileRoute('/admin')({ component: AdminPage })

function AdminPage() {
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const createScan = useMutation(api.admin.createScan)
  const startExtraction = useMutation(api.admin.startExtraction)
  const scans = useQuery({
    ...convexQuery(api.admin.listScans, { adminToken }),
    enabled: adminToken.length > 0,
    retry: false,
  })

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

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

      <button
        type="button"
        disabled={!adminToken || busy}
        onClick={() => {
          setBusy(true)
          startExtraction({ adminToken })
            .then(() => setMessage('Extraction démarrée.'))
            .catch((error: unknown) =>
              setMessage(
                error instanceof Error ? error.message : String(error),
              ),
            )
            .finally(() => setBusy(false))
        }}
      >
        Démarrer l’extraction
      </button>

      {message && <p role="status">{message}</p>}
      {scans.error && <p role="alert">{scans.error.message}</p>}

      <section className="admin-page__scans">
        <h2>Scans</h2>
        {scans.isLoading && adminToken && <p>Chargement…</p>}
        {scans.data?.map((scan) => (
          <article key={scan.id} className="admin-page__scan">
            <h3>{scan.status}</h3>
            <p>
              {scan.imageCount} image · {scan.drafts.length} brouillon(s)
            </p>
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
          </article>
        ))}
      </section>
    </main>
  )
}
