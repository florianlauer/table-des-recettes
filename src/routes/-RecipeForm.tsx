import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { RECIPE_TYPES } from '../lib/recipeTypes'
import type { RecipeType } from '../lib/recipeTypes'

type ScanView = NonNullable<
  (typeof api.admin.getScanForCorrection)['_returnType']
>
export type RecipeView = ScanView['recipes'][number]
type IngredientLine = RecipeView['ingredients'][number]

/** What an admin mutation answers, plus the success message the caller may want to phrase itself. */
export type ActionOutcome =
  { ok: true; message?: string } | { ok: false; error: string }

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

const TYPE_LABELS: Record<RecipeType, string> = {
  entree: 'Entrée',
  plat: 'Plat',
  dessert: 'Dessert',
  apero: 'Apéro',
  petitDej: 'Petit déjeuner',
  autre: 'Autre',
}

/**
 * Holds no state of its own. `edited` is the page's draft when there is one, and being edited *is*
 * being dirty — so a save, a publication or anyone else's write drops the draft by bumping the
 * revision, with nothing to synchronise.
 */
export function RecipeForm({
  recipe,
  edited,
  adminToken,
  busy,
  publishBlocked,
  onChange,
  onRun,
}: {
  recipe: RecipeView
  edited: Draft | null
  adminToken: string
  busy: boolean
  publishBlocked: boolean
  onChange: (draft: Draft) => void
  onRun: (action: () => Promise<ActionOutcome>) => Promise<void>
}) {
  const saveRecipe = useMutation(api.recipeAdmin.saveRecipe)
  const deleteRecipe = useMutation(api.recipeAdmin.deleteRecipe)
  const publishRecipe = useMutation(api.recipeAdmin.publishRecipe)
  const unpublishRecipe = useMutation(api.recipeAdmin.unpublishRecipe)

  const draft = edited ?? toDraft(recipe)
  const dirty = edited !== null

  function edit(patch: Partial<Draft>) {
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
