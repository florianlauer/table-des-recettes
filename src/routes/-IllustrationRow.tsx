import { useMutation } from 'convex/react'
import { useEffect, useId, useRef } from 'react'
import { api } from '../../convex/_generated/api'
import { outcomeMessage } from '../lib/gestureMessages'
import { rowGesture } from '../lib/gestures'
import {
  availableActions,
  BEAUTIFY_LEASE_MS,
  ILLUSTRATION_ACTIONS,
} from '../lib/illustrationWork'
import type { IllustrationAction } from '../lib/illustrationWork'
import { recipeStatusLabel } from '../lib/recipeStatus'
import { TYPE_LABELS } from '../lib/recipeTypes'
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
export type WorkSection = Work['active']
export type Row = WorkSection['rows'][number]
type Outcome = (typeof api.illustrations.acceptBeautified)['_returnType']

/**
 * One recipe as the arbitration screen sees it: the shots being judged, and the seven actions that
 * can be available on them. Its own file because it holds the screen's real complexity — a gesture table
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
  const markNoPhoto = useMutation(api.illustrations.markNoPhotoAvailable)
  const clearNoPhoto = useMutation(api.illustrations.clearNoPhotoAvailable)

  const available = availableActions(row, { now, leaseMs: BEAUTIFY_LEASE_MS })
  const args = { adminToken, recipeId: row.id }
  const titleId = useId()
  const generate = rowGesture(row.id, 'generate')
  // Named in the alt texts below. The confirmations name it too, but those are written where the
  // available actions are.
  const title = row.title || 'sans titre'

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

  /**
   * What each action actually calls. Keyed by name, so an action cannot reach the screen without a
   * mutation behind it: adding one to the table makes this object fail to typecheck until it is
   * wired. Everything else about an action — its label, its order, whether it asks first — is in
   * `availableActions`, where it can be tested.
   */
  const run: Record<
    Exclude<IllustrationAction, 'upload'>,
    () => Promise<Outcome>
  > = {
    accept: () => acceptBeautified(args),
    reject: () => rejectPending(args),
    generate: () => {
      // Remembered before the call, not after: this is the value the release effect compares against.
      startedAtAtClick.current = row.beautifyStartedAt
      return requestBeautify(args)
    },
    unpublish: () => unpublishAccepted(args),
    deleteCandidate: () => deleteCandidate(args),
    abandon: () => abandonBeautify(args),
    detach: () => detachIllustration(args),
    markNoPhoto: () => markNoPhoto(args),
    unmarkNoPhoto: () => clearNoPhoto(args),
  }

  // The catalogue, not what is available right now: `upload` is in it like the rest, because posting
  // a photo is the longest thing the row does and its result has the same right to be republished.
  const busy = ILLUSTRATION_ACTIONS.some(
    (action) => gestures.running(rowGesture(row.id, action)) !== null,
  )

  /**
   * An action on this screen usually removes its own control: accepting takes "Accepter" away,
   * detaching takes "Retirer la photo" away. The row stays, so nothing marks it — but the button that
   * held the message is gone, and the result would be lost. Those outcomes are orphaned too, and the
   * section republishes them.
   */
  const visible = new Set<IllustrationAction>(
    available.map((action) => action.name),
  )
  useEffect(() => {
    for (const action of ILLUSTRATION_ACTIONS) {
      if (visible.has(action)) continue
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
        {TYPE_LABELS[row.type]} · {recipeStatusLabel(row.status)}
        {row.beautifiedAccepted && ' · embellissement publié'}
        {row.noPhotoAvailable && ' · pas de photo dans la source'}
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
          {/* Lazy, and it matters here more than anywhere: the queue lists dozens of rows, each
              carrying a page photographed at full resolution. */}
          <img
            src={row.originalUrl}
            alt={`Photo de ${title}`}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            Photo d’origine
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
            alt={`Embellissement de ${title}`}
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
          Vignette d’affichage impossible :{' '}
          {row.originalRendition?.state === 'failed'
            ? row.originalRendition.error
            : row.candidateRendition?.state === 'failed'
              ? row.candidateRendition.error
              : ''}
        </p>
      )}

      {available.map((action) =>
        action.control === 'file' ? (
          <AdminFileInput
            key={action.name}
            gestures={gestures}
            gesture={rowGesture(row.id, action.name)}
            label={action.label}
            pendingLabel={action.pendingLabel}
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
        ) : (
          <AdminButton
            key={action.name}
            gestures={gestures}
            gesture={rowGesture(row.id, action.name)}
            label={action.label}
            pendingLabel={action.pendingLabel}
            confirm={action.confirm}
            settle={action.settle}
            estimateMs={action.settle ? estimateMs : null}
            titleId={titleId}
            run={async () => outcomeMessage(await run[action.name]())}
          />
        ),
      )}
    </article>
  )
}
