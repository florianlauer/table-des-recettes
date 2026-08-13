import { useMutation } from 'convex/react'
import { useEffect, useId, useRef } from 'react'
import { api } from '../../convex/_generated/api'
import { outcomeMessage } from '../lib/gestureMessages'
import { rowGesture } from '../lib/gestures'
import { BEAUTIFY_LEASE_MS, illustrationActions } from '../lib/illustrationWork'
import { useAttachIllustration } from '../lib/useAttachIllustration'
import type { Gestures } from '../lib/useGestures'
import { uploadProgress } from '../lib/uploadProgress'
import { AdminButton } from './-AdminButton'
import { AdminFileInput } from './-AdminFileInput'
import { GestureProgress } from './-GestureProgress'

/**
 * Read off the server rather than retyped: the wire shape is declared once, as a validator, and every
 * shape here is inferred from it. A hand-kept copy is unguarded — it typechecks clean while being
 * wrong, and it drifts weaker than the contract without saying so.
 */
type Work = (typeof api.illustrations.listIllustrationWork)['_returnType']
export type Row = Work['active'][number]
type Outcome = (typeof api.illustrations.acceptBeautified)['_returnType']

/**
 * One recipe as the arbitration screen sees it: the shots being judged, and the seven gestures that
 * can be offered on them. Its own file because it holds the screen's real complexity — a gesture table
 * and two observation effects — while the page around it is a list of sections.
 */
export function IllustrationRow({
  row,
  adminToken,
  gestures,
  now,
  estimateMs,
}: {
  row: Row
  adminToken: string
  gestures: Gestures
  now: number
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
    /** Run before the mutation, for a gesture that has to remember the state it started from. */
    beforeRun?: () => void
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
      beforeRun: () => {
        startedAtAtClick.current = row.beautifyStartedAt
      },
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
          thing being judged — unreadable.

          `thumbnails` says the urls point at display derivatives, which are ~292px wide: shown in
          the 34rem plate they would be blurred, so the inventory buckets get a bounded box instead.
          The plate itself is untouched wherever there is something to arbitrate. */}
      {row.originalUrl && (
        <figure
          className={
            row.thumbnails ? 'illustrations__thumb' : 'illustrations__shot'
          }
        >
          <img
            src={row.originalUrl}
            alt={`Photo de ${row.title}`}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            Photo d'origine
            {row.originalRendition?.state === 'failed'
              ? ' — vignette impossible'
              : ''}
          </figcaption>
        </figure>
      )}
      {row.candidateUrl && (
        <figure
          className={
            row.thumbnails ? 'illustrations__thumb' : 'illustrations__shot'
          }
        >
          <img
            src={row.candidateUrl}
            alt={`Embellissement de ${row.title}`}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            Candidat embelli
            {row.beautifiedAccepted ? ' (publié)' : ''}
            {row.candidateRendition?.state === 'failed'
              ? ' — vignette impossible'
              : ''}
          </figcaption>
        </figure>
      )}
      {/* The fallback of `recipes.browse` renders correctly and quietly costs the full weight, so the
          screen that already exists to say "there is work left on the photos" is where it is said. */}
      {[row.originalRendition, row.candidateRendition].some(
        (rendition) => rendition?.state === 'failed',
      ) && (
        <p role="alert">
          Vignette d'affichage impossible :{' '}
          {row.originalRendition?.state === 'failed'
            ? row.originalRendition.error
            : row.candidateRendition?.state === 'failed'
              ? row.candidateRendition.error
              : ''}
        </p>
      )}

      {can.replace && (
        <AdminFileInput
          gestures={gestures}
          gesture={rowGesture(row.id, 'upload')}
          label={row.hasOriginal ? 'Remplacer la photo' : 'Ajouter une photo'}
          pendingLabel="Envoi…"
          onFiles={async (files, report) => {
            const file = files[0]
            if (!file) return { ok: false, text: 'Aucun fichier.' }
            return outcomeMessage(
              await attachIllustration(file, {
                recipeId: row.id,
                onPhase: (phase) =>
                  report(uploadProgress({ done: 0, total: 1, phase })),
              }),
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
            run={async () => {
              gesture.beforeRun?.()
              return outcomeMessage(await gesture.run())
            }}
          />
        ))}
    </article>
  )
}
