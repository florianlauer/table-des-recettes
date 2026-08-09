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
        The blocks of the spread are real containers, not direct children placed with
        `grid-column`: without a wrapper, grid auto-placement gives each one its own row.
        The back link stays outside them so both columns start on the same line.
      */}
      <Link to="/" className="back">
        Retour à l'index
      </Link>

      <div className="recipe__head">
        <h1 className="recipe__title">{recipe.title}</h1>
        <p className="recipe__type" data-type={recipe.type}>
          {TYPE_LABELS[recipe.type]}
        </p>
      </div>

      <div className="recipe__aside">
        {servings ? (
          <div className="servings">
            <button
              className="servings__btn"
              aria-label="Une personne de moins"
              disabled={current <= 1}
              // Functional form, not `current - 1`: several taps inside one batch all read the
              // same rendered `current` and collapse into a single step. Greasy fingers tap
              // twice.
              onClick={() => setTarget((t) => Math.max(1, (t ?? servings) - 1))}
            >
              −
            </button>
            {/*
              −/+ rewrites every quantity in the list. Without a live region the change is
              silent, and `aria-atomic` is what makes it read "6 personnes" and not just "6".
            */}
            <span className="servings__value" aria-live="polite" aria-atomic="true">
              {current} {current > 1 ? 'personnes' : 'personne'}
            </span>
            <button
              className="servings__btn"
              aria-label="Une personne de plus"
              onClick={() => setTarget((t) => (t ?? servings) + 1)}
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
                <>
                  {/*
                    The dagger carried its meaning in a `title`, which is unreliable on a screen
                    reader and never reachable on touch — the main surface. The explanation is
                    now read in place, at the end of its own line.
                  */}
                  <span className="ingredients__fixed" aria-hidden="true">
                    {' '}
                    †
                  </span>
                  <span className="visually-hidden"> — quantité non recalculée</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>

        {/* Hidden from assistive tech: its only job is to decode a glyph that, for a screen
            reader, no longer exists — each concerned line now carries its own explanation. */}
        {showNote ? (
          <p className="ingredients__note" aria-hidden="true">
            † Cette quantité n'a pas pu être recalculée : la ligne est reproduite telle
            quelle.
          </p>
        ) : null}

        {recipe.imageUrl ? <img className="recipe__photo" src={recipe.imageUrl} alt="" /> : null}
      </div>

      <div className="recipe__method">
        <h2 className="recipe__section">Préparation</h2>
        <ol className="steps">
          {recipe.steps.map((step, i) => (
            <li key={i} className="steps__item">
              {step}
            </li>
          ))}
        </ol>
      </div>
    </main>
  )
}
