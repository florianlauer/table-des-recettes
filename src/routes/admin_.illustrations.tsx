import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { estimateFrom } from '../lib/estimate'
import { outcomeMessage } from '../lib/gestureMessages'
import { pageGesture } from '../lib/gestures'
import { useGestures, useOrphanedRows } from '../lib/useGestures'
import type { Gestures } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'
import { AdminButton } from './-AdminButton'
import { BeautifyStats } from './-BeautifyStats'
import { IllustrationRow } from './-IllustrationRow'
import { OrphanedOutcomes } from './-OrphanedOutcomes'

export const Route = createFileRoute('/admin_/illustrations')({
  component: IllustrationsPage,
})

/**
 * Read off the server rather than retyped: the wire shape is declared once, as a validator, and
 * every shape on this screen is inferred from it. A hand-kept copy is unguarded — it typechecks
 * clean while being wrong, and it drifts weaker than the contract without saying so.
 */
type Work = (typeof api.illustrations.listIllustrationWork)['_returnType']

/**
 * The most counter-intuitive result of the T13 bench, and the screen is the only place where it can
 * act: framed wide, keeping the printed text, the model cleared the credibility barrier 4 times out
 * of 4; framed tight on the dish alone, 1 out of 4. It restores when it has to cut out.
 */
const FRAMING_ADVICE =
  'Photographie la page telle quelle, en gardant le texte imprimé autour du plat.'

function IllustrationsPage() {
  const [adminToken, setAdminToken] = useState('')
  const [includeIllustrated, setIncludeIllustrated] = useState(false)
  const gestures = useGestures({ epoch: `illustrations:${adminToken}` })
  const { now } = useServerClock(adminToken)

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

  const work = useQuery({
    ...convexQuery(
      api.illustrations.listIllustrationWork,
      adminToken ? { adminToken, includeIllustrated } : 'skip',
    ),
    retry: false,
  })
  // Hoisted out of the statistics block: the journal that reports what a generation costs is also
  // what says how long one usually takes, and every row's bar reads it.
  const stats = useQuery({
    ...convexQuery(
      api.illustrations.beautifyStats,
      adminToken ? { adminToken } : 'skip',
    ),
    retry: false,
  })
  const estimateMs = estimateFrom(stats.data ?? [])

  const data = work.data

  /**
   * A working row can leave the data under its own gesture — a photo attached moves the recipe out of
   * "Sans photo". Its run is kept until it resolves and its message resurfaces at section level;
   * dropping it here would discard the completion instead.
   */
  const liveRowIds = data
    ? new Set<string>(
        [...data.active, ...data.withoutIllustration, ...data.illustrated].map(
          (row) => row.id,
        ),
      )
    : null
  useOrphanedRows({ gestures, liveRowIds })

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

      <OrphanedOutcomes gestures={gestures} />

      {data && (
        <>
          <MigrationBanner
            adminToken={adminToken}
            migration={data.migration}
            gestures={gestures}
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
                gestures={gestures}
                now={now}
                estimateMs={estimateMs}
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
                gestures={gestures}
                now={now}
                estimateMs={estimateMs}
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
                  gestures={gestures}
                  now={now}
                  estimateMs={estimateMs}
                />
              ))}
          </section>

          <BeautifyStats
            groups={stats.data}
            error={stats.error}
            estimateMs={estimateMs}
          />
        </>
      )}
    </main>
  )
}

function MigrationBanner({
  adminToken,
  migration,
  gestures,
}: {
  adminToken: string
  migration: Work['migration']
  gestures: Gestures
}) {
  const startBackfill = useMutation(api.migrations.startIllustrationBackfill)
  if (migration.done) return null
  // A div, not a `<p role="alert">`: a bar, a result and a blocked reason are blocks, and the count
  // below changes as the backfill advances — announced assertively at every tick it would be noise.
  return (
    <div className="admin-page__banner">
      <p>
        {migration.started
          ? `Migration en cours : ${migration.migrated} recette(s) indexée(s). La liste « sans photo » n'est pas encore exhaustive.`
          : "Les recettes antérieures ne sont pas encore indexées : la liste « sans photo » n'est pas exhaustive."}
      </p>
      {/* No bar: `listIllustrationWork` reports how many recipes are indexed and no total — one
          document read, which is exactly what the batched backfill exists to preserve. A fraction
          would need a denominator nobody can produce without scanning the table. */}
      <AdminButton
        gestures={gestures}
        gesture={pageGesture('migrate')}
        label={
          migration.started ? 'Relancer la migration' : 'Lancer la migration'
        }
        pendingLabel="Migration…"
        disabled={!adminToken}
        run={async () => outcomeMessage(await startBackfill({ adminToken }))}
      />
    </div>
  )
}
