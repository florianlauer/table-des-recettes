import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import { scaleRecipe } from '../lib/scale'
import { TYPE_LABELS } from '../shared/recipeTypes'

/**
 * Beyond this the `+` is answering a stuck finger, not a cook. It bounds the repeat tap the way
 * `−` is already bounded at one person; the disabled state is the same one.
 */
const MAX_SERVINGS = 50

export const Route = createFileRoute('/recette/$slug')({
  loader: async ({ context, params }) => {
    // Without `notFound()`, an unknown slug would answer HTTP 200 with a message in the body.
    const recipe = await context.queryClient.ensureQueryData(
      convexQuery(api.recipes.getBySlug, { slug: params.slug }),
    )
    if (!recipe) throw notFound()
    return { title: recipe.title }
  },
  // Every recipe shared the index's title, so a browser with four open pages showed four
  // identical tabs and a history nobody could read back.
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.title} — La table des recettes`
          : 'La table des recettes',
      },
    ],
  }),
  // The same shell as the load failure, for the same reason: a page of one sentence gives no clue
  // where one has landed.
  notFoundComponent: () => (
    <main className="page failure">
      <p className="failure__site">La table des recettes</p>
      <p className="failure__line">Cette recette n’existe pas.</p>
      <Link to="/" className="back">
        Retour à l’index
      </Link>
    </main>
  ),
  component: RecipePage,
})

function RecipePage() {
  const { slug } = Route.useParams()
  const recipe = useSuspenseQuery(
    convexQuery(api.recipes.getBySlug, { slug }),
  ).data
  const [target, setTarget] = useState<number | null>(null)

  // The loader already threw `notFound()` if the recipe does not exist.
  if (!recipe) return null

  const servings = recipe.servings
  const current = target ?? servings ?? 0
  const { lines, note } = scaleRecipe(recipe.ingredients, {
    from: servings,
    to: current,
  })

  return (
    <main className="page recipe">
      {/*
        The blocks of the spread are real containers, not direct children placed with
        `grid-column`: without a wrapper, grid auto-placement gives each one its own row.
        The back link stays outside them so both columns start on the same line.
      */}
      <Link to="/" className="back">
        Retour à l’index
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
            <span
              className="servings__value"
              aria-live="polite"
              aria-atomic="true"
            >
              {current} {current > 1 ? 'personnes' : 'personne'}
            </span>
            <button
              className="servings__btn"
              aria-label="Une personne de plus"
              disabled={current >= MAX_SERVINGS}
              onClick={() =>
                setTarget((t) => Math.min(MAX_SERVINGS, (t ?? servings) + 1))
              }
            >
              +
            </button>
          </div>
        ) : null}

        <h2 className="recipe__section">Ingrédients</h2>
        {/*
          Keyed by the servings so −/+ substitutes the list instead of editing it in place: that is
          what lets `.swap` fade the new quantities in. The remount costs nothing here — the list
          holds no focusable control and no input state.
        */}
        <ul className="ingredients swap" key={current}>
          {lines.map(({ text, marked }, i) => (
            <li key={i} className="ingredients__item">
              {text}
              {marked ? (
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
                  <span className="visually-hidden">
                    {' '}
                    — quantité non ajustée
                  </span>
                </>
              ) : null}
            </li>
          ))}
        </ul>

        {/* Hidden from assistive tech: its only job is to decode a glyph that, for a screen
            reader, no longer exists — each concerned line now carries its own explanation. */}
        {note ? (
          <p className="ingredients__note" aria-hidden="true">
            † {note}
          </p>
        ) : null}

        {recipe.imageUrl ? (
          <img
            className="recipe__photo"
            src={recipe.imageUrl}
            alt=""
            {...(recipe.imageWidth && recipe.imageHeight
              ? { width: recipe.imageWidth, height: recipe.imageHeight }
              : {})}
            // Under 900px the CSS gives this photo `order: 1`, which puts it at the very end of the
            // recipe. Without `lazy` it downloaded before the reader had scrolled anywhere near it.
            loading="lazy"
            decoding="async"
          />
        ) : null}
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
