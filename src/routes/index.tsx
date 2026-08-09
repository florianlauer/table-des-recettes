import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../convex/_generated/api'
import type { PublishedRecipeRow } from '../../convex/recipes'
import { groupByLetter } from '../lib/groupByLetter'
import { RECIPE_TYPES, TYPE_FILTER_LABELS, TYPE_LABELS } from '../lib/recipeTypes'
import type { RecipeType } from '../lib/recipeTypes'

const searchSchema = z.object({
  q: z.string().optional(),
  type: z.enum(RECIPE_TYPES).optional(),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  // Sans ce loader, `useSuspenseQuery` se résout côté client seulement : la page
  // arriverait vide en SSR, ce qui contredit la décision de garder le SSR.
  loaderDeps: ({ search }) => ({ q: search.q, type: search.type }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.recipes.countsByType, {})),
      context.queryClient.ensureQueryData(browseOptions(deps)),
    ])
  },
  component: IndexPage,
})

/** Une seule query pour l'index : la bascule liste ↔ recherche vit dans Convex. */
function browseOptions({ q, type }: { q?: string; type?: RecipeType }) {
  return convexQuery(api.recipes.browse, { query: q?.trim() || undefined, type })
}

function IndexPage() {
  const { q, type } = Route.useSearch()
  const navigate = Route.useNavigate()
  const searching = Boolean(q && q.trim())

  // Le champ est piloté localement, l'URL suit avec 250 ms de retard. Taper « courgette »
  // ne doit empiler ni neuf entrées d'historique ni neuf abonnements Convex — mais tout
  // remplacer effacerait aussi l'index vide, et le bouton retour quitterait le site au
  // lieu d'y revenir. Seule l'entrée dans la recherche est donc empilée ; les frappes
  // suivantes remplacent.
  const [draft, setDraft] = useState(q ?? '')
  useEffect(() => setDraft(q ?? ''), [q])
  useEffect(() => {
    const current = q ?? ''
    if (draft === current) return
    const id = setTimeout(() => {
      navigate({
        search: (prev) => ({ ...prev, q: draft || undefined }),
        replace: current !== '',
      })
    }, 250)
    return () => clearTimeout(id)
  }, [draft, q, navigate])

  const counts = useSuspenseQuery(convexQuery(api.recipes.countsByType, {})).data
  const listed = useSuspenseQuery(browseOptions({ q, type })).data

  return (
    <main className="page">
      <header className="masthead">
        <h1 className="masthead__title">La table des recettes</h1>
        <p className="masthead__count">{counts.total} recettes</p>
      </header>

      <input
        className="search"
        type="search"
        value={draft}
        placeholder="Rechercher une recette"
        aria-label="Rechercher une recette"
        onChange={(e) => setDraft(e.target.value)}
      />

      <nav className="filters" aria-label="Types de plat">
        <button
          className="filters__item"
          aria-current={type === undefined}
          onClick={() => navigate({ search: (prev) => ({ ...prev, type: undefined }) })}
        >
          Toutes <span className="filters__count">{counts.total}</span>
        </button>
        {RECIPE_TYPES.filter((t) => counts.byType[t]).map((t) => (
          <button
            key={t}
            className="filters__item"
            aria-current={type === t}
            onClick={() => navigate({ search: (prev) => ({ ...prev, type: t }) })}
          >
            {TYPE_FILTER_LABELS[t]} <span className="filters__count">{counts.byType[t]}</span>
          </button>
        ))}
      </nav>

      {listed.length === 0 ? (
        <p className="empty">
          {counts.total === 0 ? 'Aucune recette publiée.' : 'Aucune recette ne correspond.'}
        </p>
      ) : searching ? (
        <ol className="index index--flat">
          {listed.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} showImage={false} />
          ))}
        </ol>
      ) : (
        groupByLetter(listed).map((group) => (
          <section className="group" key={group.letter}>
            <ol className="index">
              {group.items.map((recipe, i) => (
                <RecipeRow
                  key={recipe.id}
                  recipe={recipe}
                  letter={i === 0 ? group.letter : undefined}
                  showImage
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </main>
  )
}

function RecipeRow({
  recipe,
  letter,
  showImage,
}: {
  recipe: PublishedRecipeRow
  letter?: string
  showImage: boolean
}) {
  return (
    <li className="row">
      <span className="row__letter" aria-hidden={!letter}>
        {letter ?? ''}
      </span>
      <div className="row__body">
        <Link to="/recette/$slug" params={{ slug: recipe.slug }} className="row__title">
          {recipe.title}
        </Link>
        <span className="row__type">{TYPE_LABELS[recipe.type]}</span>
        {recipe.matchedIngredient ? (
          <p className="row__reason">{recipe.matchedIngredient}</p>
        ) : null}
        {showImage && recipe.imageUrl ? (
          <img className="row__photo" src={recipe.imageUrl} alt="" loading="lazy" />
        ) : null}
      </div>
    </li>
  )
}
