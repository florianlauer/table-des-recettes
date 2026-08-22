import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { literalUnion } from './validators'

/**
 * The recipe that already carries this title, as the correction screen needs to name it.
 *
 * `slug` and `scanId` are the two recourses, and neither implies the other: `slug` is non-null once
 * a recipe has *ever* been published — it survives unpublication (ADR 0001) — and `scanId` is
 * non-null when the recipe came from a scan rather than being added by hand. Which recourse the form
 * offers is decided by `status`, never by the presence of a slug: a twin taken offline still has
 * one, and it addresses a page the storefront no longer serves.
 *
 * Validator first and the type inferred from it, as `attemptRecord` does in `schema.ts`: the query's
 * return shape and this function's return type are the same fact, and two hand-written copies drift
 * in silence — widen one and the code compiles while the query throws at return validation.
 */
export const titleTwin = v.object({
  title: v.string(),
  status: literalUnion(['review', 'published'] as const),
  slug: v.union(v.string(), v.null()),
  scanId: v.union(v.id('scans'), v.null()),
})

export type TitleTwin = Infer<typeof titleTwin>

/**
 * Whether another recipe already carries this title. The oracle is `titleKey` — the title folded by
 * `slugify`, written by `withSearchText` on every title write — so « Tarte Tatin », « TARTE TATIN »
 * and « tarte tatin » are one title, and a recipe never published counts exactly as much as one on
 * the shelf.
 *
 * It is deliberately not the slug, which was the first attempt. A slug is minted at publication, so
 * two drafts of the same page had none and neither was warned — the very case the screen exists for.
 * And a slug carries a collision suffix, so probing `gateau-2` for a draft titled « Gateau » found
 * the recipe titled « Gateau 2 » and reported a homonym that was not one.
 *
 * What the fold does and does not do, since `searchText` trains the opposite expectation: it removes
 * accents, case and punctuation, so « Pâté » and « Pâte » are one key — and it does **not** stem, so
 * « Crêpe » and « Crêpes » are two. Deliberate: this key means « the same title », and a warning is
 * cheap while a missed one is not, whereas stemming « riz » into « ri » would pair unrelated pages.
 *
 * A published twin is named in preference to a draft one, and the index is what holds that rather
 * than a second probe: `status` is the second key, and `'published'` sorts before `'review'`, so
 * every published holder of a key comes back before every draft holder of it. That matters because
 * index order is otherwise creation order — with three copies of one title, two drafts created
 * before the published one were all a key-only probe ever saw, and the screen said « attend en
 * relecture » about a title that was on the storefront.
 *
 * The dependency is on a lexicographic accident of two words, so it is not left to luck: « names the
 * published copy, not the oldest one » in `recipeAdmin.test.ts` fails the moment that order changes,
 * whether by renaming a status or by dropping the second key of the index.
 *
 * `take(2)`, not `first()`: this recipe is itself in the index under its own key, so the first row
 * back is as likely to be the recipe asking the question.
 */
export async function findTitleTwin(
  ctx: QueryCtx,
  recipe: Doc<'recipes'>,
): Promise<TitleTwin | null> {
  const key = recipe.titleKey
  // Neither of these two states is a title, and both are shared. `''` is what every untitled draft
  // folds to — publication refuses them anyway — and `undefined` is every row the backfill has not
  // reached yet. Convex does index an absent field (that is how `backfillTitleKey` selects its
  // range), which is exactly why the guard is needed: matching on either would pair up the whole set.
  if (key === undefined || key === '') return null

  const holders = await ctx.db
    .query('recipes')
    .withIndex('by_title_key_and_status', (q) => q.eq('titleKey', key))
    .take(2)
  const twin = holders.find((holder) => holder._id !== recipe._id)
  if (twin === undefined) return null
  return {
    title: twin.title,
    status: twin.status,
    slug: twin.slug ?? null,
    scanId: twin.scanId ?? null,
  }
}
