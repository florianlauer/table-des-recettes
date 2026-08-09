import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { scaleIngredient, servingsFactor } from '../lib/scale'
import { TYPE_LABELS } from '../lib/recipeTypes'

export const Route = createFileRoute('/recette/$slug')({
  loader: async ({ context, params }) => {
    // Without `notFound()`, an unknown slug would answer HTTP 200 with a message in the body.
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

  // The loader already threw `notFound()` if the recipe does not exist.
  if (!recipe) return null

  const servings = recipe.servings
  const current = target ?? servings ?? 0
  const factor = servings ? servingsFactor(servings, current) : 1

  // Computed once: the line marker and the footnote must depend on exactly the same
  // predicate, otherwise a dagger can appear with nothing explaining it.
  const lines = recipe.ingredients.map((ingredient) => scaleIngredient(ingredient, factor))
  const showNote = factor !== 1 && lines.some((line) => !line.scaled)

  return (
    <main className="page recipe">
      {/*
        The two columns of the spread are real containers, not direct children placed with
        `grid-column`: without a wrapper, grid auto-placement gives each one its own row and
        the right column drops down instead of starting at the top, facing the title.
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
