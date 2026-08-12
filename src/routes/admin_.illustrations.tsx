import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { beautifyGroupKey } from '../lib/beautifyStats'
import type { WireBeautifySummary } from '../lib/beautifyStats'
import { estimateFrom } from '../lib/estimate'
import { outcomeMessage } from '../lib/gestureMessages'
import { pageGesture, rowGesture } from '../lib/gestures'
import { BEAUTIFY_LEASE_MS, illustrationActions } from '../lib/illustrationWork'
import { useAttachIllustration } from '../lib/useAttachIllustration'
import { useGestures } from '../lib/useGestures'
import type { Gestures } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { uploadFraction, uploadNote } from '../lib/uploadProgress'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'
import { AdminButton } from './-AdminButton'
import { AdminFileInput } from './-AdminFileInput'
import { GestureProgress } from './-GestureProgress'
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
type Row = Work['active'][number]
type Outcome = (typeof api.illustrations.acceptBeautified)['_returnType']

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
  const { now, offset } = useServerClock(adminToken)
  const [focusClaimed, setFocusClaimed] = useState(false)

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
  const liveRowIds = new Set(
    data
      ? [...data.active, ...data.withoutIllustration, ...data.illustrated].map(
          (row) => row.id,
        )
      : [],
  )
  useEffect(() => {
    if (!data) return
    for (const gesture of gestures.liveGestures()) {
      if (gesture.scope.kind !== 'row') continue
      if (liveRowIds.has(gesture.scope.rowId as Row['id'])) continue
      if (gestures.holdsFocus(gesture.scope.rowId)) setFocusClaimed(true)
      gestures.markOrphaned(gesture)
    }
  })

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

      <OrphanedOutcomes gestures={gestures} claimFocus={focusClaimed} />

      {data && (
        <>
          <MigrationBanner
            adminToken={adminToken}
            migration={data.migration}
            gestures={gestures}
            offset={offset}
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
                offset={offset}
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
                offset={offset}
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
                  offset={offset}
                  estimateMs={estimateMs}
                />
              ))}
          </section>

          <BeautifyStatsBlock
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
  offset,
}: {
  adminToken: string
  migration: Work['migration']
  gestures: Gestures
  offset: number
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
        offset={offset}
        run={async () => outcomeMessage(await startBackfill({ adminToken }))}
      />
    </div>
  )
}

function IllustrationRow({
  row,
  adminToken,
  gestures,
  now,
  offset,
  estimateMs,
}: {
  row: Row
  adminToken: string
  gestures: Gestures
  now: number
  offset: number
  estimateMs: number | null
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
  const titleId = useId()
  const generate = rowGesture(row.id, 'generate')

  /**
   * `requestBeautify` schedules and returns; the work then lives in `beautifyStatus`. The gesture is
   * released only once the data shows the transition — and the signal is `beautifyStartedAt`, which
   * the mutation always bumps, rather than a status that may read the same before and after.
   */
  const startedAtAtClick = useRef<number | null>(null)
  const waiting = gestures.running(generate) !== null
  useEffect(() => {
    if (!waiting) return
    if (row.beautifyStartedAt !== startedAtAtClick.current)
      gestures.confirm(generate)
  })

  // Order is the reading order of the screen, and it is data rather than seven near-identical JSX
  // blocks: what distinguishes a gesture is its label and its mutation, nothing else.
  const gestureRows: {
    offered: boolean
    action: string
    label: string
    pendingLabel: string
    confirm?: string
    settle?: boolean
    run: () => Promise<Outcome>
  }[] = [
    {
      offered: can.accept,
      action: 'accept',
      label: 'Accepter l’embellissement',
      pendingLabel: 'Acceptation…',
      run: () => acceptBeautified(args),
    },
    {
      offered: can.reject,
      action: 'reject',
      label: 'Rejeter le candidat',
      pendingLabel: 'Rejet…',
      run: () => rejectPending(args),
    },
    {
      offered: can.generate,
      action: 'generate',
      label: row.hasCandidate ? 'Régénérer' : 'Embellir',
      pendingLabel: 'Embellissement…',
      settle: true,
      run: () => requestBeautify(args),
    },
    {
      offered: can.unpublish,
      action: 'unpublish',
      label: 'Dépublier l’embellissement',
      pendingLabel: 'Dépublication…',
      run: () => unpublishAccepted(args),
    },
    {
      offered: can.deleteCandidate,
      action: 'deleteCandidate',
      label: 'Supprimer le candidat conservé',
      pendingLabel: 'Suppression…',
      run: () => deleteCandidate(args),
    },
    {
      offered: can.abandon,
      action: 'abandon',
      label: 'Abandonner cette génération',
      pendingLabel: 'Abandon…',
      run: () => abandonBeautify(args),
    },
    {
      offered: can.detach,
      action: 'detach',
      label: 'Retirer la photo',
      pendingLabel: 'Retrait…',
      confirm: `Retirer la photo de « ${row.title} » ?`,
      run: () => detachIllustration(args),
    },
  ]

  // `upload` too, not just the buttons: posting a photo is the longest thing the row does, and it is
  // the one gesture whose control is a file input rather than a button.
  const rowActions = [...gestureRows.map(({ action }) => action), 'upload']
  const busy = rowActions.some(
    (action) => gestures.running(rowGesture(row.id, action)) !== null,
  )

  /**
   * A gesture on this screen usually removes its own control: accepting takes "Accepter" away,
   * detaching takes "Retirer la photo" away. The row stays, so nothing marks it — but the button that
   * held the message is gone, and the result would be lost. Those outcomes are orphaned too, and the
   * section republishes them.
   */
  const offered = new Set([
    ...gestureRows.filter(({ offered: shown }) => shown).map((g) => g.action),
    ...(can.replace ? ['upload'] : []),
  ])
  useEffect(() => {
    for (const action of rowActions) {
      if (offered.has(action)) continue
      const gesture = rowGesture(row.id, action)
      if (gestures.outcome(gesture) === null) continue
      gestures.markOrphaned(gesture)
    }
  })

  return (
    <article
      className="illustrations__recipe"
      data-row-id={row.id}
      aria-busy={busy}
    >
      <h3 id={titleId}>{row.title || 'Sans titre'}</h3>
      <p>
        {row.type} · {row.status}
        {row.beautifiedAccepted && ' · embellissement publié'}
      </p>
      {/* The real wait: the click came back in 300 ms, the generation runs for tens of seconds. */}
      {row.beautifyStatus === 'generating' && (
        <div className="illustrations__waiting">
          <p>Génération en cours…</p>
          {row.beautifyStartedAt !== null && (
            <GestureProgress
              startedAt={row.beautifyStartedAt}
              estimateMs={estimateMs}
              offset={offset}
              labelledBy={titleId}
              // A new generation is a new execution: the monotonic floor must not inherit the
              // maximum of the one before it.
              token={row.beautifyStartedAt}
            />
          )}
        </div>
      )}
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
        <AdminFileInput
          gestures={gestures}
          gesture={rowGesture(row.id, 'upload')}
          label={row.hasOriginal ? 'Remplacer la photo' : 'Ajouter une photo'}
          pendingLabel="Envoi…"
          offset={offset}
          onFiles={async (files, report) => {
            const file = files[0]
            if (!file) return { ok: false, text: 'Aucun fichier.' }
            return outcomeMessage(
              await attachIllustration(file, row.id, (phase) =>
                report({
                  fraction: uploadFraction({ done: 0, total: 1, phase }),
                  text: uploadNote({ done: 0, total: 1, phase }),
                }),
              ),
            )
          }}
        />
      )}

      {gestureRows
        .filter((gesture) => gesture.offered)
        .map((gesture) => (
          <AdminButton
            key={gesture.action}
            gestures={gestures}
            gesture={rowGesture(row.id, gesture.action)}
            label={gesture.label}
            pendingLabel={gesture.pendingLabel}
            confirm={gesture.confirm}
            settle={gesture.settle}
            estimateMs={gesture.settle ? estimateMs : null}
            titleId={titleId}
            offset={offset}
            run={async () => {
              if (gesture.action === 'generate')
                startedAtAtClick.current = row.beautifyStartedAt
              return outcomeMessage(await gesture.run())
            }}
          />
        ))}
    </article>
  )
}

function BeautifyStatsBlock({
  groups,
  error,
  estimateMs,
}: {
  groups: WireBeautifySummary[] | undefined
  error: Error | null
  estimateMs: number | null
}) {
  return (
    <section className="admin-page__stats">
      <h2>Générations d'images</h2>
      {error && <p role="alert">{error.message}</p>}
      {groups?.length === 0 && <p>Aucune génération journalisée.</p>}
      {estimateMs === null && groups !== undefined && groups.length > 0 && (
        <p>
          Pas encore assez d'appels sur la configuration en service pour estimer
          une durée.
        </p>
      )}
      {groups?.map((group) => (
        <article key={beautifyGroupKey(group)} className="admin-page__stat">
          <h3>
            {group.model} · {group.servedProvider ?? 'provider inconnu'} ·
            prompt {group.promptVersion}
            {group.isCurrent && ' · en service'}
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
