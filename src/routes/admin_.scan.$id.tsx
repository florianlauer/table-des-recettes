import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAdminToken } from '../lib/adminToken'
import { readyData } from '../lib/dataView'
import { formatCount } from '../lib/formatCount'
import { formatUsd } from '../lib/formatNumber'
import { estimateFrom } from '../lib/journalStats'
import { outcomeMessage } from '../lib/gestureMessages'
import { pageGesture } from '../lib/gestures'
import { scanStatusLabel } from '../lib/scanLabel'
import { MAX_IMAGES_PER_SCAN } from '../lib/scanLimits'
import { useAdminQuery } from '../lib/useAdminQuery'
import { useAttachImage } from '../lib/useAttachImage'
import { useGestures, useOrphanedRows } from '../lib/useGestures'
import { useServerClock } from '../lib/useServerClock'
import { uploadProgress } from '../lib/uploadProgress'
import { adminHead } from './-adminHead'
import { AdminButton } from './-AdminButton'
import { AdminFailure } from './-AdminFailure'
import { AdminFileInput } from './-AdminFileInput'
import { GestureProgress } from './-GestureProgress'
import { OrphanedOutcomes } from './-OrphanedOutcomes'
import { RecipeForm } from './-RecipeForm'
import type { Draft, RecipeView } from './-RecipeForm'

export const Route = createFileRoute('/admin_/scan/$id')({
  component: ScanCorrectionPage,
  head: adminHead,
})

/** A draft, and the revision it answers. */
type Edit = { revision: number; draft: Draft }

function ScanCorrectionPage() {
  const { id } = Route.useParams()
  const scanId = id as Id<'scans'>
  const { token } = useAdminToken()
  const adminToken = token ?? ''
  // The only editing state on the page. An entry stops counting the moment the server moves the
  // recipe underneath it, so publication reads liveness rather than a flag someone has to maintain,
  // and a deleted recipe takes its entry out of the reckoning by leaving `data.recipes`.
  const [edits, setEdits] = useState<Record<string, Edit>>({})

  // The scan is part of the epoch: navigating to another scan must not leave a run of this one
  // locking the controls of the next.
  const gestures = useGestures({ epoch: `scan:${scanId}:${adminToken}` })
  // Read for its correction of the shared clock, which every bar on this page hangs on.
  useServerClock(adminToken)

  const attachImage = useAttachImage(adminToken)
  const detachImage = useMutation(api.admin.detachImage)
  const rescan = useMutation(api.admin.rescan)
  const addRecipe = useMutation(api.recipeAdmin.addRecipe)
  const publishScan = useMutation(api.recipeAdmin.publishScan)
  const acknowledgeImageChange = useMutation(
    api.recipeAdmin.acknowledgeImageChange,
  )

  const scan = useAdminQuery(token, api.admin.getScanForCorrection, { scanId })
  // The extraction relaunched from here is the same work the queue journals, so the same journal
  // says how long it usually takes.
  const stats = useAdminQuery(token, api.admin.attemptStats, {})
  const estimateMs = estimateFrom(readyData(stats) ?? [])

  // Not `readyData`: this query answers `null` for a scan that does not exist, and that answer is
  // the one below saying « Scan introuvable ». Folding it into « nothing yet » would print the
  // verdict over every load.
  const data = scan.kind === 'ready' ? scan.data : undefined
  const purged = data != null && data.purgedAt !== null
  const imagesChanged = Boolean(data?.imagesChangedAt)
  const liveEdit = (recipe: RecipeView): Draft | null => {
    const edit = edits[recipe.id]
    return edit?.revision === recipe.revision ? edit.draft : null
  }
  const anyDirty =
    data?.recipes.some((recipe) => liveEdit(recipe) !== null) ?? false

  // A deletion takes the form out of the list while its own gesture is still running: the run is
  // kept until it resolves and its message resurfaces below, rather than vanishing with the row.
  const liveRecipeIds = data
    ? new Set<string>(data.recipes.map((recipe) => recipe.id))
    : null
  useOrphanedRows({ gestures, liveRowIds: liveRecipeIds })

  const publishBlockedReason = imagesChanged
    ? 'Les images ont changé : relis les recettes avant de publier.'
    : anyDirty
      ? 'Des corrections ne sont pas enregistrées.'
      : undefined

  return (
    <main className="page admin-page">
      <header className="admin-page__header">
        <h1>Correction du scan</h1>
        <p>
          <Link to="/admin">Retour à l’administration</Link>
        </p>
      </header>

      {/* Only once storage has actually been read: browser storage is invisible to the server
          render and to the first client render, so this alert used to greet every operator who
          had a token. */}
      {scan.kind === 'absent' && (
        <p role="alert">Jeton absent : passe par /admin.</p>
      )}
      {scan.kind === 'failed' && (
        <AdminFailure error={scan.error} retry={scan.refetch} />
      )}
      {scan.kind === 'loading' && <p>Chargement…</p>}
      {data === null && <p role="alert">Scan introuvable.</p>}

      <OrphanedOutcomes gestures={gestures} />

      {data && (
        <>
          <section className="scan-page__images">
            <h2>Pages d’origine</h2>
            {purged ? (
              <p>
                Photos purgées. La correction reste possible, pas la relance de
                l’extraction.
              </p>
            ) : (
              <>
                {data.images.length === 0 && <p>Aucune image.</p>}
                {data.images.map((image, index) => (
                  <figure key={image.storageId} className="scan-page__image">
                    {image.url && (
                      <img
                        src={image.url}
                        alt={`Page ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <figcaption>
                      Page {index + 1} / {data.images.length}
                      {/* Page scope, one action per page: removing an image rewrites the scan and
                          stamps `imagesChangedAt`, which blocks every recipe's publication. */}
                      <AdminButton
                        gestures={gestures}
                        gesture={pageGesture(`detach:${image.storageId}`)}
                        label="Retirer"
                        pendingLabel="Retrait…"
                        confirm={`Retirer la page ${index + 1} ?`}
                        run={async () =>
                          outcomeMessage(
                            await detachImage({
                              adminToken,
                              scanId,
                              storageId: image.storageId,
                            }),
                          )
                        }
                      />
                    </figcaption>
                  </figure>
                ))}
                {data.images.length < MAX_IMAGES_PER_SCAN && (
                  <AdminFileInput
                    gestures={gestures}
                    gesture={pageGesture('upload')}
                    label="Ajouter une page à ce scan"
                    pendingLabel="Envoi…"
                    onFiles={async (files, report) => {
                      const file = files[0]
                      if (!file) return { ok: false, text: 'Aucun fichier.' }
                      return outcomeMessage(
                        await attachImage(file, {
                          scanId,
                          onPhase: (phase) =>
                            report(
                              uploadProgress({ done: 0, total: 1, phase }),
                            ),
                        }),
                      )
                    }}
                  />
                )}
              </>
            )}
          </section>

          {/* A div, not a `<p role="alert">`: the control inside now carries a result and a bar,
              which are blocks. The alert stays on the sentence. */}
          {imagesChanged && (
            <div className="admin-page__banner">
              <p role="alert">
                Les images ont changé depuis l’extraction. La publication est
                bloquée tant que les recettes n’ont pas été relues.
              </p>
              <AdminButton
                gestures={gestures}
                gesture={pageGesture('acknowledge')}
                label="Les corrections sont à jour"
                pendingLabel="Enregistrement…"
                run={async () =>
                  outcomeMessage(
                    await acknowledgeImageChange({ adminToken, scanId }),
                  )
                }
              />
            </div>
          )}

          <section className="scan-page__actions">
            <p>
              État : {scanStatusLabel(data.status)}
              {data.error && ` · ${data.error}`}
              {data.totalCostUsd !== null &&
                ` · ${formatUsd(data.totalCostUsd)} consommés`}
            </p>
            {/* The extraction is the server's work, not the click's: the bar hangs on the scan's
                own `startedAt`, so it is there after a reload too. */}
            {data.startedAt !== null && (
              <GestureProgress
                startedAt={data.startedAt}
                estimateMs={estimateMs}
                token={data.startedAt}
              />
            )}
            <AdminButton
              gestures={gestures}
              gesture={pageGesture('rescan')}
              label="Relancer l’extraction"
              pendingLabel="Relance…"
              confirm="Relancer supprime les brouillons de ce scan. Continuer ?"
              disabled={purged || data.images.length === 0}
              blockedReason={
                purged
                  ? 'Les photos de ce scan sont purgées.'
                  : 'Ce scan ne porte aucune image.'
              }
              run={async () =>
                outcomeMessage(await rescan({ adminToken, scanId }))
              }
            />
            <AdminButton
              gestures={gestures}
              gesture={pageGesture('addRecipe')}
              label="Ajouter une recette"
              pendingLabel="Ajout…"
              run={async () =>
                outcomeMessage(await addRecipe({ adminToken, scanId }))
              }
            />
            <AdminButton
              gestures={gestures}
              gesture={pageGesture('publishScan')}
              label="Tout publier"
              pendingLabel="Publication…"
              disabled={anyDirty || imagesChanged}
              blockedReason={publishBlockedReason}
              run={async () => {
                const result = await publishScan({ adminToken, scanId })
                if (!result.ok) return { ok: false, text: result.error }
                return { ok: true, text: publicationReport(result) }
              }}
            />
          </section>

          {data.recipesTruncated && (
            <p role="alert">
              Ce scan porte plus de recettes que l’écran n’en affiche :
              corrige-les une par une.
            </p>
          )}

          <section className="scan-page__recipes">
            <h2>Recettes</h2>
            {data.recipes.length === 0 && (
              <p>
                Aucune recette. Ajoute-la à la main si la page est illisible.
              </p>
            )}
            {data.recipes.map((recipe) => (
              <RecipeForm
                key={recipe.id}
                recipe={recipe}
                edited={liveEdit(recipe)}
                adminToken={adminToken}
                gestures={gestures}
                publishBlocked={imagesChanged}
                onChange={(draft) =>
                  setEdits((current) => ({
                    ...current,
                    [recipe.id]: { revision: recipe.revision, draft },
                  }))
                }
              />
            ))}
          </section>
        </>
      )}
    </main>
  )
}

/** Names the drafts that stayed behind: a count alone would not tell the operator what to fix. */
export function publicationReport({
  published,
  refused,
}: {
  published: number
  refused: readonly { title: string; error: string }[]
}): string {
  const head = `${formatCount(published, 'publiée', 'publiées')}.`
  if (refused.length === 0) return head
  const detail = refused
    .map((row) => `${row.title || 'sans titre'} (${row.error})`)
    .join(' · ')
  return `${head} Refusées : ${detail}`
}
