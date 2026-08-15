import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'
import { z } from 'zod'
import { api } from '../../convex/_generated/api'
import type { PublishedRecipeRow } from '../../convex/recipes'
import { formatCount } from '../lib/formatCount'
import { groupByLetter } from '../lib/groupByLetter'
import { indexStatusLine } from '../lib/indexStatusLine'
import {
  RECIPE_TYPES,
  TYPE_FILTER_LABELS,
  TYPE_LABELS,
} from '../shared/recipeTypes'
import type { RecipeType } from '../shared/recipeTypes'
import { useSearchDraft } from '../lib/useSearchDraft'

/**
 * How many rows load their photo eagerly. Four is what fits above the fold on the tallest phone we
 * care about; beyond that the lazy loader is doing its job, and below it a lazy first photo is what
 * delays the LCP when a photo *is* the LCP element.
 */
const EAGER_ROWS = 4

const searchSchema = z.object({
  q: z.string().optional(),
  type: z.enum(RECIPE_TYPES).optional(),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  // Without this loader `useSuspenseQuery` only resolves client-side: the page would arrive
  // empty under SSR, which contradicts the decision to keep SSR.
  loaderDeps: ({ search }) => ({ q: search.q, type: search.type }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(countsOptions()),
      context.queryClient.ensureQueryData(countsOptions(deps.q)),
      context.queryClient.ensureQueryData(browseOptions(deps)),
    ])
  },
  component: IndexPage,
})

/**
 * Two scopes of the same count. Without an argument it is the shelf — what the masthead says and
 * what tells "nothing published" apart from "nothing matches". With the search it is the matches,
 * which is what the filter row must promise. The args are built here rather than inline so that an
 * empty search produces the same key as no search at all: one subscription, not two.
 */
function countsOptions(rawQuery?: string) {
  const query = rawQuery?.trim()
  return convexQuery(api.recipes.countsByType, query ? { query } : {})
}

/** A single query for the index: the list ↔ search switch lives in Convex. */
function browseOptions({ q, type }: { q?: string; type?: RecipeType }) {
  return convexQuery(api.recipes.browse, {
    query: q?.trim() || undefined,
    type,
  })
}

function IndexPage() {
  const { q, type } = Route.useSearch()
  const navigate = Route.useNavigate()
  const searching = Boolean(q && q.trim())
  const restricted = searching || type !== undefined
  // The same rule the search field follows: entering the filters is worth a history entry, walking
  // between them is not. Five taps used to mean five presses of Back before leaving the site.
  const replace = type !== undefined
  const filterSearch =
    (next: RecipeType | undefined) =>
    (prev: { q?: string; type?: RecipeType }) => ({ ...prev, type: next })

  // The field is driven locally and the URL follows a debounce behind; `useSearchDraft` owns that
  // lag, which is trickier than it looks — see `searchDraft.ts`.
  const [draft, setDraft, clearDraft] = useSearchDraft({
    q,
    commit: ({ q: next, replace: replaceEntry }) =>
      navigate({
        search: (prev) => ({ ...prev, q: next }),
        replace: replaceEntry,
      }),
  })
  const field = useRef<HTMLInputElement>(null)

  const shelf = useSuspenseQuery(countsOptions()).data
  const counts = useSuspenseQuery(countsOptions(q)).data
  const listed = useSuspenseQuery(browseOptions({ q, type })).data

  // Searching dissolves the groups and hides every photo, so neither the grouping nor the eager set
  // has anything to do there — and `groupByLetter` sorts, so computing it anyway would re-sort the
  // whole list on each keystroke to throw the result away.
  const groups = searching ? [] : groupByLetter(listed)
  // One sentence for the restriction, whichever form it takes: the count while there are results,
  // the absence and its cause when there are none. `null` when nothing restricts the index.
  const status = indexStatusLine({ count: listed.length, query: q, type })
  // Which rows sit above the fold, and therefore load eagerly: everything else stays lazy. The
  // position has to be **global**, because a row's rank inside its letter says nothing about where it
  // is on the page — and the query's order is not the display order either, since grouping sorts.
  const eager = new Set(
    groups
      .flatMap((group) => group.items)
      .slice(0, EAGER_ROWS)
      .map((recipe) => recipe.id),
  )

  return (
    <main className="page">
      <header className="masthead">
        <h1 className="masthead__title">La table des recettes</h1>
        <p className="masthead__count">{formatCount(shelf.total, 'recette')}</p>
      </header>

      {/*
        `type="text"`, not `search`: the native clear only appears on focus, and never in Firefox, so
        the only way out of the search regime was invisible on the surface that matters. The × below
        is always there once something is typed.
      */}
      <div className="search-field">
        <input
          ref={field}
          className="search"
          type="text"
          value={draft}
          placeholder="Rechercher une recette"
          aria-label="Rechercher une recette"
          // A recipe name is not prose: iOS capitalised it and offered to correct « sarrasin ».
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          // The keyboard convention, kept as a second way out for whoever has a keyboard.
          onKeyDown={(e) => {
            if (e.key === 'Escape') clearDraft()
          }}
        />
        {draft === '' ? null : (
          <button
            type="button"
            className="search__clear"
            // The glyph is hidden from assistive tech and the name is written out: a multiplication
            // sign read aloud is not an instruction.
            aria-label="Effacer la recherche"
            onClick={() => {
              clearDraft()
              // Erasing is not leaving: the next thing one does is type another word.
              field.current?.focus()
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      <nav className="filters" aria-label="Types de plat">
        <button
          className="filters__item"
          aria-current={type === undefined}
          onClick={() => navigate({ search: filterSearch(undefined), replace })}
        >
          Toutes <span className="filters__count">{counts.total}</span>
        </button>
        {RECIPE_TYPES.filter((t) => counts.byType[t]).map((t) => (
          <button
            key={t}
            className="filters__item"
            data-type={t}
            aria-current={type === t}
            onClick={() => navigate({ search: filterSearch(t), replace })}
          >
            {TYPE_FILTER_LABELS[t]}{' '}
            <span className="filters__count">{counts.byType[t]}</span>
          </button>
        ))}
      </nav>

      {/*
        One line, read by everyone. It was `visually-hidden`, so the sighted reader got a list whose
        regime had silently changed and no sentence saying so. Rendered even when empty: a live region
        has to be in the DOM before its text changes to be announced at all.
      */}
      <p className="status" role="status">
        {status ?? ''}
      </p>

      {/*
        The key is the restriction, and it is what makes the fade fire: a debounce and a button both
        substitute this whole block, so React has to be told it is a new one rather than the same one
        with other children. The animation itself is `.swap` in the stylesheet, opacity only and only
        without `prefers-reduced-motion`.
      */}
      <div className="swap" key={`${q?.trim() ?? ''}|${type ?? ''}`}>
        {listed.length === 0 && !restricted ? (
          <p className="empty">Aucune recette publiée.</p>
        ) : searching ? (
          <ol className="index index--flat" aria-label="Résultats">
            {listed.map((recipe) => (
              <RecipeRow key={recipe.id} recipe={recipe} showImage={false} />
            ))}
          </ol>
        ) : (
          groups.map((group) => (
            <section
              className="group"
              key={group.letter}
              aria-labelledby={`groupe-${group.letter}`}
            >
              <h2 className="group__letter" id={`groupe-${group.letter}`}>
                {group.letter}
              </h2>
              <ol className="index">
                {group.items.map((recipe) => (
                  <RecipeRow
                    key={recipe.id}
                    recipe={recipe}
                    showImage
                    eager={eager.has(recipe.id)}
                  />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </main>
  )
}

function RecipeRow({
  recipe,
  showImage,
  eager = false,
}: {
  recipe: PublishedRecipeRow
  showImage: boolean
  eager?: boolean
}) {
  return (
    <li className="row">
      <div className="row__body">
        <Link
          to="/recette/$slug"
          params={{ slug: recipe.slug }}
          className="row__title"
        >
          {recipe.title}
        </Link>
        <span className="row__type" data-type={recipe.type}>
          {TYPE_LABELS[recipe.type]}
        </span>
        {recipe.matchedIngredient ? (
          <p className="row__reason">{recipe.matchedIngredient}</p>
        ) : null}
        {showImage && recipe.imageUrl ? (
          <img
            className="row__photo"
            src={recipe.imageUrl}
            alt=""
            // The CSS pins the height and leaves the width free, so these are what let the browser
            // compute the box from the ratio. Absent when only an underived source is available:
            // no attribute is better than a wrong one.
            {...(recipe.imageWidth && recipe.imageHeight
              ? { width: recipe.imageWidth, height: recipe.imageHeight }
              : {})}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : null}
      </div>
    </li>
  )
}
