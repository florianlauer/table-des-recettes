import { useMutation } from 'convex/react'
import { useId, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { outcomeMessage } from '../lib/gestureMessages'
import { rowGesture } from '../lib/gestures'
import { RECIPE_STATUS_LABELS } from '../lib/recipeStatus'
import { RECIPE_TYPES, TYPE_LABELS } from '../shared/recipeTypes'
import type { RecipeType } from '../shared/recipeTypes'
import type { Gestures } from '../lib/useGestures'
import { AdminButton } from './-AdminButton'

type ScanView = NonNullable<
  (typeof api.admin.getScanForCorrection)['_returnType']
>
export type RecipeView = ScanView['recipes'][number]
type IngredientLine = RecipeView['ingredients'][number]

/**
 * The form's shape rather than the recipe's: portions and steps are edited as text and only become
 * a number and a list when they are saved.
 */
export type Draft = {
  title: string
  type: RecipeType
  servings: string
  ingredients: IngredientLine[]
  ingredientsInferred: boolean
  steps: string
}

export function toDraft(recipe: RecipeView): Draft {
  return {
    title: recipe.title,
    type: recipe.type,
    servings: recipe.servings === null ? '' : String(recipe.servings),
    ingredients: [...recipe.ingredients],
    ingredientsInferred: recipe.ingredientsInferred,
    steps: recipe.steps.join('\n'),
  }
}

/** The columns of the parsed line, in the order the grid lays them out. */
const INGREDIENT_COLUMNS = ['Ligne', 'Quantité', 'Unité', 'Libellé'] as const

/**
 * Holds no state the server could disagree with. `edited` is the page's draft when there is one, and
 * being edited *is* being dirty — so a save, a publication or anyone else's write drops the draft by
 * bumping the revision, with nothing to synchronise. The removed line below is the exception, and
 * deliberately not part of the draft: it is an offer to undo, not a value anyone means to save.
 */
export function RecipeForm({
  recipe,
  edited,
  adminToken,
  gestures,
  publishBlocked,
  onChange,
}: {
  recipe: RecipeView
  edited: Draft | null
  adminToken: string
  gestures: Gestures
  publishBlocked: boolean
  onChange: (draft: Draft) => void
}) {
  const saveRecipe = useMutation(api.recipeAdmin.saveRecipe)
  const deleteRecipe = useMutation(api.recipeAdmin.deleteRecipe)
  const publishRecipe = useMutation(api.recipeAdmin.publishRecipe)
  const unpublishRecipe = useMutation(api.recipeAdmin.unpublishRecipe)

  const titleId = useId()
  const [removed, setRemoved] = useState<{
    index: number
    line: IngredientLine
  } | null>(null)
  const draft = edited ?? toDraft(recipe)
  const dirty = edited !== null
  const save = rowGesture(recipe.id, 'save')
  const publish = rowGesture(recipe.id, 'publish')
  const unpublish = rowGesture(recipe.id, 'unpublish')
  const remove = rowGesture(recipe.id, 'delete')
  const rowGestures = [save, publish, unpublish, remove]
  const busy = rowGestures.some((gesture) => gestures.running(gesture) !== null)
  const settled = rowGestures.some(
    (gesture) => gestures.outcome(gesture) !== null,
  )

  function edit(patch: Partial<Draft>) {
    // « Fait. » next to a field that has changed since describes a value nobody can see any more.
    // Guarded, so a keystroke does not rewrite the registry for nothing.
    if (settled) gestures.clearOutcomes(save)
    onChange({ ...draft, ...patch })
  }

  function editIngredient(index: number, patch: Partial<IngredientLine>) {
    edit({
      ingredients: draft.ingredients.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    })
  }

  return (
    <article
      className="scan-page__recipe"
      data-row-id={recipe.id}
      aria-busy={busy}
    >
      <h3 id={titleId}>{recipe.title || 'Sans titre'}</h3>
      <p>
        {RECIPE_STATUS_LABELS[recipe.status]}
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
        {/* Named columns, not four boxes of decreasing width: the labels existed for assistive tech
            and nowhere for the eye, so telling the quantity from the unit meant clicking one. */}
        {draft.ingredients.length > 0 && (
          <div
            className="scan-page__ingredient scan-page__ingredient--head"
            aria-hidden="true"
          >
            {INGREDIENT_COLUMNS.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
        )}
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
              placeholder="Quantité"
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
              placeholder="Unité"
              value={line.unit ?? ''}
              onChange={(event) =>
                editIngredient(index, {
                  unit: event.target.value || undefined,
                })
              }
            />
            <input
              aria-label={`Libellé ${index + 1}`}
              placeholder="Libellé"
              value={line.label ?? ''}
              onChange={(event) =>
                editIngredient(index, {
                  label: event.target.value || undefined,
                })
              }
            />
            <button
              type="button"
              onClick={() => {
                setRemoved({ index, line })
                edit({
                  ingredients: draft.ingredients.filter(
                    (_, position) => position !== index,
                  ),
                })
              }}
            >
              Retirer
            </button>
          </div>
        ))}
        {/* The line came off a photograph: retyping it means going back to the page. Offered until
            another one is removed, and it returns where it was, not at the end. */}
        {removed !== null && (
          <p className="scan-page__undo" role="status">
            <button
              type="button"
              onClick={() => {
                const ingredients = [...draft.ingredients]
                ingredients.splice(removed.index, 0, removed.line)
                setRemoved(null)
                edit({ ingredients })
              }}
            >
              Rétablir « {removed.line.raw || 'ligne vide'} »
            </button>
          </p>
        )}
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

      <AdminButton
        gestures={gestures}
        gesture={save}
        label="Enregistrer"
        pendingLabel="Enregistrement…"
        disabled={!dirty}
        blockedReason="Rien à enregistrer : le formulaire est celui du serveur."
        titleId={titleId}
        run={async () =>
          outcomeMessage(
            await saveRecipe({
              adminToken,
              recipeId: recipe.id,
              expectedRevision: recipe.revision,
              title: draft.title.trim(),
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
      />

      {recipe.status === 'review' ? (
        <AdminButton
          gestures={gestures}
          gesture={publish}
          label="Publier"
          pendingLabel="Publication…"
          // Publishing a form the operator has already edited would put the stale server value
          // online — a wrong page, not a lost keystroke.
          disabled={dirty || publishBlocked}
          blockedReason={
            dirty
              ? 'Enregistre tes corrections avant de publier.'
              : 'Les images ont changé : relis la recette avant de publier.'
          }
          titleId={titleId}
          run={async () =>
            outcomeMessage(
              await publishRecipe({ adminToken, recipeId: recipe.id }),
            )
          }
        />
      ) : (
        <AdminButton
          gestures={gestures}
          gesture={unpublish}
          label="Dépublier"
          pendingLabel="Dépublication…"
          titleId={titleId}
          run={async () =>
            outcomeMessage(
              await unpublishRecipe({ adminToken, recipeId: recipe.id }),
            )
          }
        />
      )}

      <AdminButton
        gestures={gestures}
        gesture={remove}
        label="Supprimer"
        pendingLabel="Suppression…"
        confirm={`Supprimer « ${recipe.title || 'sans titre'} » définitivement ?`}
        disabled={recipe.status === 'published'}
        blockedReason="Dépublie la recette avant de la supprimer."
        titleId={titleId}
        run={async () =>
          outcomeMessage(
            await deleteRecipe({ adminToken, recipeId: recipe.id }),
          )
        }
      />
    </article>
  )
}
