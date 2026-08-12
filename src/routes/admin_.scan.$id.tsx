import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MAX_IMAGES_PER_SCAN } from '../lib/scanLimits'
import { useAttachImage } from '../lib/useAttachImage'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'
import { RecipeForm } from './-RecipeForm'
import type { ActionOutcome, Draft, RecipeView } from './-RecipeForm'

export const Route = createFileRoute('/admin_/scan/$id')({
  component: ScanCorrectionPage,
})

/** A draft, and the revision it answers. */
type Edit = { revision: number; draft: Draft }

function ScanCorrectionPage() {
  const { id } = Route.useParams()
  const scanId = id as Id<'scans'>
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // The only editing state on the page. An entry stops counting the moment the server moves the
  // recipe underneath it, so publication reads liveness rather than a flag someone has to maintain,
  // and a deleted recipe takes its entry out of the reckoning by leaving `data.recipes`.
  const [edits, setEdits] = useState<Record<string, Edit>>({})

  const attachImage = useAttachImage(adminToken)
  const detachImage = useMutation(api.admin.detachImage)
  const rescan = useMutation(api.admin.rescan)
  const addRecipe = useMutation(api.recipeAdmin.addRecipe)
  const publishScan = useMutation(api.recipeAdmin.publishScan)
  const acknowledgeImageChange = useMutation(
    api.recipeAdmin.acknowledgeImageChange,
  )

  useEffect(() => {
    setAdminToken(sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '')
  }, [])

  const scan = useQuery({
    ...convexQuery(
      api.admin.getScanForCorrection,
      adminToken ? { adminToken, scanId } : 'skip',
    ),
    retry: false,
  })

  async function run(action: () => Promise<ActionOutcome>) {
    setBusy(true)
    try {
      const result = await action()
      setMessage(result.ok ? (result.message ?? 'Fait.') : result.error)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const data = scan.data
  const purged = data != null && data.purgedAt !== null
  const imagesChanged = Boolean(data?.imagesChangedAt)
  const liveEdit = (recipe: RecipeView): Draft | null => {
    const edit = edits[recipe.id]
    return edit?.revision === recipe.revision ? edit.draft : null
  }
  const anyDirty =
    data?.recipes.some((recipe) => liveEdit(recipe) !== null) ?? false

  return (
    <main className="page admin-page">
      <header className="admin-page__header">
        <h1>Correction du scan</h1>
        <p>
          <Link to="/admin">Retour à l'administration</Link>
        </p>
      </header>

      {!adminToken && <p role="alert">Jeton absent : passe par /admin.</p>}
      {scan.error && <p role="alert">{scan.error.message}</p>}
      {scan.isLoading && adminToken && <p>Chargement…</p>}
      {data === null && <p role="alert">Scan introuvable.</p>}
      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <section className="scan-page__images">
            <h2>Pages d'origine</h2>
            {purged ? (
              <p>
                Photos purgées. La correction reste possible, pas la relance de
                l'extraction.
              </p>
            ) : (
              <>
                {data.images.length === 0 && <p>Aucune image.</p>}
                {data.images.map((image, index) => (
                  <figure key={image.storageId} className="scan-page__image">
                    {image.url && (
                      <img src={image.url} alt={`Page ${index + 1}`} />
                    )}
                    <figcaption>
                      Page {index + 1} / {data.images.length}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Retirer la page ${index + 1} ?`))
                            return
                          void run(() =>
                            detachImage({
                              adminToken,
                              scanId,
                              storageId: image.storageId,
                            }),
                          )
                        }}
                      >
                        Retirer
                      </button>
                    </figcaption>
                  </figure>
                ))}
                {data.images.length < MAX_IMAGES_PER_SCAN && (
                  <label className="admin-page__field">
                    Ajouter une page à ce scan
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void run(() => attachImage(file, scanId))
                      }}
                    />
                  </label>
                )}
              </>
            )}
          </section>

          {imagesChanged && (
            <p role="alert">
              Les images ont changé depuis l'extraction. La publication est
              bloquée tant que les recettes n'ont pas été relues.{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => acknowledgeImageChange({ adminToken, scanId }))
                }
              >
                Les corrections sont à jour
              </button>
            </p>
          )}

          <section className="scan-page__actions">
            <p>
              État : {data.status}
              {data.error && ` · ${data.error}`}
              {data.totalCostUsd !== null &&
                ` · ${data.totalCostUsd.toFixed(4)} USD consommés`}
            </p>
            <button
              type="button"
              disabled={busy || purged || data.images.length === 0}
              title={purged ? 'Les photos de ce scan sont purgées' : undefined}
              onClick={() => {
                if (
                  !window.confirm(
                    'Relancer supprime les brouillons de ce scan. Continuer ?',
                  )
                )
                  return
                void run(() => rescan({ adminToken, scanId }))
              }}
            >
              Relancer l'extraction
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => addRecipe({ adminToken, scanId }))}
            >
              Ajouter une recette
            </button>
            <button
              type="button"
              disabled={busy || anyDirty || imagesChanged}
              onClick={() =>
                void run(async () => {
                  const result = await publishScan({ adminToken, scanId })
                  if (!result.ok) return result
                  return { ok: true, message: publicationReport(result) }
                })
              }
            >
              Tout publier
            </button>
          </section>

          {data.recipesTruncated && (
            <p role="alert">
              Ce scan porte plus de recettes que l'écran n'en affiche :
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
                busy={busy}
                publishBlocked={imagesChanged}
                onChange={(draft) =>
                  setEdits((current) => ({
                    ...current,
                    [recipe.id]: { revision: recipe.revision, draft },
                  }))
                }
                onRun={run}
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
  const head = `${published} publiée(s).`
  if (refused.length === 0) return head
  const detail = refused
    .map((row) => `${row.title || 'sans titre'} (${row.error})`)
    .join(' · ')
  return `${head} Refusées : ${detail}`
}
