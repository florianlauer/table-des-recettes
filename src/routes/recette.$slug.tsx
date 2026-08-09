import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { scaleIngredient, servingsFactor } from '../lib/scale'
import { TYPE_LABELS } from '../lib/recipeTypes'

export const Route = createFileRoute('/recette/$slug')({
  loader: async ({ context, params }) => {
    // Sans `notFound()`, un slug inconnu répondrait HTTP 200 avec un message dans le corps.
    const recipe = await context.queryClient.ensureQueryData(
      convexQuery(api.recipes.getBySlug, { slug: params.slug }),
    )
    if (!recipe) throw notFound()
  },
  notFoundComponent: () => (
    <main className="page">
      <p className="empty">Cette recette n’existe pas.</p>
      <Link to="/" className="back">
        Retour à l’index
      </Link>
    </main>
  ),
  component: RecipePage,
})

function RecipePage() {
  const { slug } = Route.useParams()
  const recipe = useSuspenseQuery(convexQuery(api.recipes.getBySlug, { slug })).data
  const [target, setTarget] = useState<number | null>(null)

  // Le loader a déjà levé `notFound()` si la recette n'existe pas.
  if (!recipe) return null

  const servings = recipe.servings
  const current = target ?? servings ?? 0
  const factor = servings ? servingsFactor(servings, current) : 1

  // Calculé une seule fois : le marqueur de ligne et la note de bas de liste doivent
  // dépendre exactement du même prédicat, sinon une dague peut apparaître sans explication.
  const lines = recipe.ingredients.map((ingredient) => scaleIngredient(ingredient, factor))
  const showNote = factor !== 1 && lines.some((line) => !line.scaled)

  return (
    <main className="page recipe">
      {/*
        Les deux colonnes de la double page sont deux vrais conteneurs, pas des
        enfants directs placés par `grid-column` : sans wrapper, l'auto-placement
        de la grille donne une ligne à chacun et la colonne de droite descend au
        lieu de commencer en haut, face au titre.
      */}
      <div className="recipe__left">
        <Link to="/" className="back">
          Retour à l'index
        </Link>
        <h1 className="recipe__title">{recipe.title}</h1>
        <p className="recipe__type">{TYPE_LABELS[recipe.type]}</p>
      </div>

      <div className="recipe__right">
        {servings ? (
          <div className="servings">
            <button
              className="servings__btn"
              aria-label="Une personne de moins"
              onClick={() => setTarget(Math.max(1, current - 1))}
            >
              −
            </button>
            <span className="servings__value">
              {current} {current > 1 ? 'personnes' : 'personne'}
            </span>
            <button
              className="servings__btn"
              aria-label="Une personne de plus"
              onClick={() => setTarget(current + 1)}
            >
              +
            </button>
          </div>
        ) : null}

        <h2 className="recipe__section">Ingrédients</h2>
        <ul className="ingredients">
          {lines.map(({ text, scaled }, i) => (
            <li key={i} className="ingredients__item">
              {text}
              {factor !== 1 && !scaled ? (
                <span className="ingredients__fixed" title="Quantité non recalculée">
                  {' '}
                  †
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {showNote ? (
          <p className="ingredients__note">
            † Cette quantité n'a pas pu être recalculée : la ligne est reproduite telle
            quelle.
          </p>
        ) : null}
      </div>

      {recipe.imageUrl ? <img className="recipe__photo" src={recipe.imageUrl} alt="" /> : null}

      <h2 className="recipe__section recipe__section--steps">Préparation</h2>
      <ol className="steps">
        {recipe.steps.map((step, i) => (
          <li key={i} className="steps__item">
            {step}
          </li>
        ))}
      </ol>
    </main>
  )
}
