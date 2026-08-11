import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { RECIPE_TYPES } from '../lib/recipeTypes'
import type { RecipeType } from '../lib/recipeTypes'
import { MAX_IMAGES_PER_SCAN } from '../lib/scanLimits'
import { useAttachImage } from '../lib/useAttachImage'
import { ADMIN_TOKEN_STORAGE_KEY } from './admin'

export const Route = createFileRoute('/admin_/scan/$id')({
  component: ScanCorrectionPage,
})

type ScanView = NonNullable<
  (typeof api.admin.getScanForCorrection)['_returnType']
>
type RecipeView = ScanView['recipes'][number]

const TYPE_LABELS: Record<RecipeType, string> = {
  entree: 'Entrée',
  plat: 'Plat',
  dessert: 'Dessert',
  apero: 'Apéro',
  petitDej: 'Petit déjeuner',
  autre: 'Autre',
}

function ScanCorrectionPage() {
  const { id } = Route.useParams()
  const scanId = id as Id<'scans'>
  const [adminToken, setAdminToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // A scan holds a handful of recipes; one dirty flag per recipe is what publication reads to
  // refuse publishing a value the operator has already replaced on screen.
  const [dirty, setDirty] = useState<Record<string, boolean>>({})

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
    ...convexQuery(api.admin.getScanForCorrection, { adminToken, scanId }),
    enabled: adminToken.length > 0,
    retry: false,
  })

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    try {
      const result = await action()
      setMessage(result.ok ? 'Fait.' : (result.error ?? 'Refusé.'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const data = scan.data
  const purged = data?.purgedAt !== null && data?.purgedAt !== undefined
  const imagesChanged = Boolean(data?.imagesChangedAt)
  const anyDirty = Object.values(dirty).some(Boolean)

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
                  setMessage(
                    `${result.published} publiée(s).` +
                      (result.refused.length > 0
                        ? ` Refusées : ${result.refused
                            .map(
                              (row) =>
                                `${row.title || 'sans titre'} (${row.error})`,
                            )
                            .join(' · ')}`
                        : ''),
                  )
                  return { ok: true }
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
                adminToken={adminToken}
                busy={busy}
                publishBlocked={imagesChanged}
                onDirty={(isDirty) =>
                  setDirty((current) => ({ ...current, [recipe.id]: isDirty }))
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

type Draft = {
  title: string
  type: RecipeType
  servings: string
  ingredients: RecipeView['ingredients']
  ingredientsInferred: boolean
  steps: string
}

function toDraft(recipe: RecipeView): Draft {
  return {
    title: recipe.title,
    type: recipe.type,
    servings: recipe.servings === null ? '' : String(recipe.servings),
    ingredients: recipe.ingredients,
    ingredientsInferred: recipe.ingredientsInferred,
    steps: recipe.steps.join('\n'),
  }
}

function RecipeForm({
  recipe,
  adminToken,
  busy,
  publishBlocked,
  onDirty,
  onRun,
}: {
  recipe: RecipeView
  adminToken: string
  busy: boolean
  publishBlocked: boolean
  onDirty: (dirty: boolean) => void
  onRun: (
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<void>
}) {
  const saveRecipe = useMutation(api.recipeAdmin.saveRecipe)
  const deleteRecipe = useMutation(api.recipeAdmin.deleteRecipe)
  const publishRecipe = useMutation(api.recipeAdmin.publishRecipe)
  const unpublishRecipe = useMutation(api.recipeAdmin.unpublishRecipe)

  const [draft, setDraft] = useState<Draft>(() => toDraft(recipe))
  const [dirty, setDirty] = useState(false)

  // Keyed on the revision alone: every write bumps it, so this is also how a publication pulls the
  // form back in line with the server. Depending on the whole object would reset the form under the
  // operator's fingers on any unrelated re-render.
  const [seenRevision, setSeenRevision] = useState(recipe.revision)
  if (seenRevision !== recipe.revision) {
    setSeenRevision(recipe.revision)
    setDraft(toDraft(recipe))
    setDirty(false)
    onDirty(false)
  }

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
    onDirty(true)
  }

  function editIngredient(index: number, patch: Record<string, unknown>) {
    edit({
      ingredients: draft.ingredients.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    })
  }

  return (
    <article className="scan-page__recipe">
      <h3>{recipe.title || 'Sans titre'}</h3>
      <p>
        {recipe.status === 'published' ? 'Publiée' : 'Brouillon'}
        {recipe.slug && ` · /recette/${recipe.slug}`}
        {recipe.ingredientsInferred && ' · ingrédients déduits'}
      </p>

      <label className="admin-page__field">
        Titre
        <input
          value={draft.title}
          onChange={(event) => edit({ title: event.target.value })}
        />
      </label>

      <label className="admin-page__field">
        Type
        <select
          value={draft.type}
          onChange={(event) => edit({ type: event.target.value as RecipeType })}
        >
          {RECIPE_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-page__field">
        Portions
        <input
          inputMode="numeric"
          value={draft.servings}
          onChange={(event) => edit({ servings: event.target.value })}
        />
      </label>

      <fieldset className="scan-page__ingredients">
        <legend>Ingrédients</legend>
        {/* Four fields, not one: the servings selector reads `quantity` and rewrites the number
            inside `raw`, so a quantity left stale behind an edited line shows a wrong figure on the
            storefront without any error. */}
        {draft.ingredients.map((line, index) => (
          <div key={index} className="scan-page__ingredient">
            <input
              aria-label={`Ligne ${index + 1}`}
              value={line.raw}
              onChange={(event) =>
                editIngredient(index, { raw: event.target.value })
              }
            />
            <input
              aria-label={`Quantité ${index + 1}`}
              inputMode="decimal"
              value={line.quantity ?? ''}
              onChange={(event) =>
                editIngredient(index, {
                  quantity:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
            <input
              aria-label={`Unité ${index + 1}`}
              value={line.unit ?? ''}
              onChange={(event) =>
                editIngredient(index, {
                  unit: event.target.value || undefined,
                })
              }
            />
            <input
              aria-label={`Libellé ${index + 1}`}
              value={line.label ?? ''}
              onChange={(event) =>
                editIngredient(index, {
                  label: event.target.value || undefined,
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                edit({
                  ingredients: draft.ingredients.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
            >
              Retirer
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            edit({ ingredients: [...draft.ingredients, { raw: '' }] })
          }
        >
          Ajouter une ligne
        </button>
      </fieldset>

      <label className="admin-page__field">
        Étapes (une par ligne)
        <textarea
          rows={8}
          value={draft.steps}
          onChange={(event) => edit({ steps: event.target.value })}
        />
      </label>

      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() =>
          void onRun(() =>
            saveRecipe({
              adminToken,
              recipeId: recipe.id,
              expectedRevision: recipe.revision,
              title: draft.title,
              type: draft.type,
              servings:
                draft.servings.trim() === ''
                  ? undefined
                  : Number(draft.servings),
              ingredients: draft.ingredients,
              ingredientsInferred: draft.ingredientsInferred,
              steps: draft.steps
                .split('\n')
                .map((step) => step.trim())
                .filter(Boolean),
            }),
          )
        }
      >
        Enregistrer
      </button>

      {recipe.status === 'review' ? (
        <button
          type="button"
          // Publishing a form the operator has already edited would put the stale server value
          // online — a wrong page, not a lost keystroke.
          disabled={busy || dirty || publishBlocked}
          onClick={() =>
            void onRun(() => publishRecipe({ adminToken, recipeId: recipe.id }))
          }
        >
          Publier
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onRun(() =>
              unpublishRecipe({ adminToken, recipeId: recipe.id }),
            )
          }
        >
          Dépublier
        </button>
      )}

      <button
        type="button"
        disabled={busy || recipe.status === 'published'}
        title={
          recipe.status === 'published'
            ? 'Dépublie la recette avant de la supprimer'
            : undefined
        }
        onClick={() => {
          if (
            !window.confirm(
              `Supprimer « ${recipe.title || 'sans titre'} » définitivement ?`,
            )
          )
            return
          void onRun(() => deleteRecipe({ adminToken, recipeId: recipe.id }))
        }}
      >
        Supprimer
      </button>
    </article>
  )
}
