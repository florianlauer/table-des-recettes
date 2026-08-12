import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { beautifyGroupKey } from '../lib/beautifyStats'
import { BEAUTIFY_LEASE_MS, illustrationActions } from '../lib/illustrationWork'
import { useAttachIllustration } from '../lib/useAttachIllustration'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'

export const Route = createFileRoute('/admin_/illustrations')({
  component: IllustrationsPage,
})

type Outcome = { ok: true } | { ok: false; error: string }

/**
 * The most counter-intuitive result of the T13 bench, and the screen is the only place where it can
 * act: framed wide, keeping the printed text, the model cleared the credibility barrier 4 times out
 * of 4; framed tight on the dish alone, 1 out of 4. It restores when it has to cut out.
 */
const FRAMING_ADVICE =
  'Photographie la page telle quelle, en gardant le texte imprimé autour du plat.'

function IllustrationsPage() {
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [includeIllustrated, setIncludeIllustrated] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

  // The abandon button appears when a lease runs out, so the page has to notice time passing.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])

  const work = useQuery({
    ...convexQuery(api.illustrations.listIllustrationWork, {
      adminToken,
      includeIllustrated,
    }),
    enabled: adminToken.length > 0,
    retry: false,
  })

  async function run(action: () => Promise<Outcome>) {
    setBusy(true)
    try {
      const result = await action()
      setMessage(result.ok ? 'Fait.' : result.error)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const data = work.data

  return (
    <main className="page admin-page">
      <header className="admin-page__header">
        <h1>Photos des plats</h1>
        <p>
          <Link to="/admin">Retour à l'administration</Link>
        </p>
        <p>{FRAMING_ADVICE}</p>
      </header>

      {!adminToken && <p role="alert">Jeton absent : passe par /admin.</p>}
      {work.error && <p role="alert">{work.error.message}</p>}
      {work.isLoading && adminToken && <p>Chargement…</p>}
      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <MigrationBanner
            adminToken={adminToken}
            migration={data.migration}
            busy={busy}
            onRun={run}
          />

          <section className="illustrations__section">
            <h2>Travail en cours</h2>
            {data.active.length === 0 && <p>Rien à arbitrer.</p>}
            {data.activeTruncated && (
              <p role="alert">
                Plus de générations en cours que l'écran n'en affiche : arbitre
                celles-ci d'abord.
              </p>
            )}
            {data.active.map((row) => (
              <IllustrationRow
                key={row.id}
                row={row}
                adminToken={adminToken}
                busy={busy}
                now={now}
                onRun={run}
              />
            ))}
          </section>

          <section className="illustrations__section">
            <h2>Sans photo</h2>
            {data.withoutIllustration.length === 0 && (
              <p>Toutes les recettes indexées ont une photo.</p>
            )}
            {data.withoutIllustrationTruncated && (
              <p>
                Liste plafonnée : traite celles-ci, les suivantes viendront.
              </p>
            )}
            {data.withoutIllustration.map((row) => (
              <IllustrationRow
                key={row.id}
                row={row}
                adminToken={adminToken}
                busy={busy}
                now={now}
                onRun={run}
              />
            ))}
          </section>

          <section className="illustrations__section">
            <h2>Déjà illustrées</h2>
            <label className="admin-page__field">
              <input
                type="checkbox"
                checked={includeIllustrated}
                onChange={(event) =>
                  setIncludeIllustrated(event.target.checked)
                }
              />
              Afficher les recettes qui ont déjà une photo
            </label>
            {includeIllustrated && data.illustratedTruncated && (
              <p>Liste plafonnée.</p>
            )}
            {includeIllustrated &&
              data.illustrated.map((row) => (
                <IllustrationRow
                  key={row.id}
                  row={row}
                  adminToken={adminToken}
                  busy={busy}
                  now={now}
                  onRun={run}
                />
              ))}
          </section>

          <BeautifyStatsBlock adminToken={adminToken} />
        </>
      )}
    </main>
  )
}

function MigrationBanner({
  adminToken,
  migration,
  busy,
  onRun,
}: {
  adminToken: string
  migration: { started: boolean; done: boolean; migrated: number }
  busy: boolean
  onRun: (action: () => Promise<Outcome>) => Promise<void>
}) {
  const startBackfill = useMutation(api.migrations.startIllustrationBackfill)
  if (migration.done) return null
  return (
    <p role="alert">
      {migration.started
        ? `Migration en cours : ${migration.migrated} recette(s) indexée(s). La liste « sans photo » n'est pas encore exhaustive.`
        : "Les recettes antérieures ne sont pas encore indexées : la liste « sans photo » n'est pas exhaustive."}{' '}
      <button
        type="button"
        disabled={!adminToken || busy}
        onClick={() => void onRun(() => startBackfill({ adminToken }))}
      >
        {migration.started ? 'Relancer la migration' : 'Lancer la migration'}
      </button>
    </p>
  )
}

type Row = {
  id: Id<'recipes'>
  title: string
  type: string
  status: 'review' | 'published'
  hasOriginal: boolean
  hasCandidate: boolean
  originalUrl: string | null
  candidateUrl: string | null
  beautifyStatus: 'idle' | 'generating' | 'review' | 'failed'
  beautifiedAccepted: boolean
  beautifyError: string | null
  beautifyStartedAt: number | null
}

function IllustrationRow({
  row,
  adminToken,
  busy,
  now,
  onRun,
}: {
  row: Row
  adminToken: string
  busy: boolean
  now: number
  onRun: (action: () => Promise<Outcome>) => Promise<void>
}) {
  const attachIllustration = useAttachIllustration(adminToken)
  const detachIllustration = useMutation(api.illustrations.detachIllustration)
  const requestBeautify = useMutation(api.illustrations.requestBeautify)
  const acceptBeautified = useMutation(api.illustrations.acceptBeautified)
  const rejectPending = useMutation(api.illustrations.rejectPendingCandidate)
  const unpublishAccepted = useMutation(
    api.illustrations.unpublishAcceptedCandidate,
  )
  const deleteCandidate = useMutation(
    api.illustrations.deleteUnpublishedCandidate,
  )
  const abandonBeautify = useMutation(api.illustrations.abandonBeautify)

  const can = illustrationActions(row, { now, leaseMs: BEAUTIFY_LEASE_MS })
  const args = { adminToken, recipeId: row.id }

  return (
    <article className="illustrations__recipe">
      <h3>{row.title || 'Sans titre'}</h3>
      <p>
        {row.type} · {row.status}
        {row.beautifiedAccepted && ' · embellissement publié'}
      </p>
      {row.beautifyStatus === 'generating' && <p>Génération en cours…</p>}
      {row.beautifyStatus === 'failed' && row.beautifyError && (
        <p role="alert">Échec : {row.beautifyError}</p>
      )}

      {/* Stacked, never side by side: on a phone, two columns make the print screen — the very
          thing being judged — unreadable. */}
      {row.originalUrl && (
        <figure className="illustrations__shot">
          <img src={row.originalUrl} alt={`Photo de ${row.title}`} />
          <figcaption>Photo d'origine</figcaption>
        </figure>
      )}
      {row.candidateUrl && (
        <figure className="illustrations__shot">
          <img src={row.candidateUrl} alt={`Embellissement de ${row.title}`} />
          <figcaption>
            Candidat embelli
            {row.beautifiedAccepted ? ' (publié)' : ''}
          </figcaption>
        </figure>
      )}

      {can.replace && (
        <label className="admin-page__field">
          {row.hasOriginal ? 'Remplacer la photo' : 'Ajouter une photo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onRun(() => attachIllustration(file, row.id))
            }}
          />
        </label>
      )}

      {can.accept && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => acceptBeautified(args))}
        >
          Accepter l'embellissement
        </button>
      )}
      {can.reject && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => rejectPending(args))}
        >
          Rejeter le candidat
        </button>
      )}
      {can.generate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => requestBeautify(args))}
        >
          {row.hasCandidate ? 'Régénérer' : 'Embellir'}
        </button>
      )}
      {can.unpublish && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => unpublishAccepted(args))}
        >
          Dépublier l'embellissement
        </button>
      )}
      {can.deleteCandidate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => deleteCandidate(args))}
        >
          Supprimer le candidat conservé
        </button>
      )}
      {can.abandon && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRun(() => abandonBeautify(args))}
        >
          Abandonner cette génération
        </button>
      )}
      {can.detach && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Retirer la photo de « ${row.title} » ?`))
              return
            void onRun(() => detachIllustration(args))
          }}
        >
          Retirer la photo
        </button>
      )}
    </article>
  )
}

function BeautifyStatsBlock({ adminToken }: { adminToken: string }) {
  const stats = useQuery({
    ...convexQuery(api.illustrations.beautifyStats, { adminToken }),
    enabled: adminToken.length > 0,
    retry: false,
  })

  return (
    <section className="admin-page__stats">
      <h2>Générations d'images</h2>
      {stats.error && <p role="alert">{stats.error.message}</p>}
      {stats.data?.length === 0 && <p>Aucune génération journalisée.</p>}
      {stats.data?.map((group) => (
        <article key={beautifyGroupKey(group)} className="admin-page__stat">
          <h3>
            {group.model} · prompt {group.promptVersion}
          </h3>
          <p>
            {group.attempts} appel(s) · {group.accepted} accepté(s) ·{' '}
            {group.rejected} rejeté(s) · {group.pending} en attente ·{' '}
            {group.discarded} abandonné(s)
          </p>
          <p>
            {group.technicalFailures} échec(s) technique(s)
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
              {group.unreportedCostCalls} appel(s) sans coût rapporté : le total
              est un plancher, pas un montant exact.
            </p>
          )}
          {group.excessiveCostCalls > 0 && (
            <p role="alert">
              {group.excessiveCostCalls} appel(s) facturé(s) bien au-dessus du
              coût mesuré.
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
