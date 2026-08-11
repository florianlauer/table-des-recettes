import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { withSearchText } from './lib/recipeWrites'
import { reconcileRetention } from './retention'
import { ingredient, recipeType } from './schema'
import { slugify } from '../src/lib/slug'
import { MAX_RECIPES_PER_SCAN, SLUG_PROBE_LIMIT } from '../src/lib/scanLimits'

const failed = (error: string) => ({ ok: false as const, error })

const okOrError = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

/** The fields the correction screen owns. Status, slug and scan parentage are not among them. */
const editableRecipe = {
  title: v.string(),
  type: recipeType,
  servings: v.optional(v.number()),
  ingredients: v.array(ingredient),
  ingredientsInferred: v.boolean(),
  steps: v.array(v.string()),
}

async function slugTaken(ctx: MutationCtx, slug: string): Promise<boolean> {
  const existing = await ctx.db
    .query('recipes')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first()
  return existing !== null
}

/**
 * Probes candidates through `by_slug` rather than collecting every slug in the corpus. The bound is
 * what keeps a pathological run of homonyms from growing the transaction without limit; past it the
 * recipe id is unique by construction, and if even that is taken we refuse rather than mint a slug
 * that would break `getBySlug`.
 *
 * Recipes that were unpublished keep their slug, so they take part in the collision — republishing
 * one must not find its name stolen (ADR 0001).
 */
async function resolveSlug(
  ctx: MutationCtx,
  recipeId: Id<'recipes'>,
  base: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  for (let suffix = 1; suffix <= SLUG_PROBE_LIMIT; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`
    if (!(await slugTaken(ctx, candidate))) return { ok: true, slug: candidate }
  }
  const fallback = `${base}-${recipeId}`
  if (await slugTaken(ctx, fallback)) {
    return failed('Impossible de dériver une adresse unique pour ce titre')
  }
  return { ok: true, slug: fallback }
}

async function loadRecipe(
  ctx: MutationCtx,
  recipeId: Id<'recipes'>,
): Promise<Doc<'recipes'> | null> {
  return ctx.db.get('recipes', recipeId)
}

/**
 * Everything publication demands of a recipe. Applied on the way in **and** on every edit of an
 * already published one: a title emptied after the fact would keep its slug and stay online with
 * content publication would have refused.
 */
function publishableTitle(title: string): boolean {
  return slugify(title).length > 0
}

async function publish(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (recipe.status === 'published') return { ok: true }
  if (!publishableTitle(recipe.title)) {
    return failed(
      `« ${recipe.title || 'Sans titre'} » n'a pas de titre publiable`,
    )
  }
  if (recipe.scanId) {
    const scan = await ctx.db.get('scans', recipe.scanId)
    if (scan?.imagesChangedAt !== undefined) {
      return failed(
        'Les images du scan ont changé depuis l’extraction : relis ou relance avant de publier',
      )
    }
  }

  // Frozen once and never recomputed: a title corrected after publication must not move the URL
  // the storefront already handed out.
  let slug = recipe.slug
  if (!slug) {
    const resolved = await resolveSlug(ctx, recipe._id, slugify(recipe.title))
    if (!resolved.ok) return resolved
    slug = resolved.slug
  }
  await ctx.db.patch(recipe._id, {
    status: 'published',
    slug,
    publishedAt: Date.now(),
    revision: (recipe.revision ?? 0) + 1,
  })
  return { ok: true }
}

export const addRecipe = mutation({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: v.union(
    v.object({ ok: v.literal(true), recipeId: v.id('recipes') }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { adminToken, scanId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return failed('Scan inconnu')
    const existing = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .take(MAX_RECIPES_PER_SCAN)
    if (existing.length >= MAX_RECIPES_PER_SCAN) {
      return failed(`Ce scan porte déjà ${MAX_RECIPES_PER_SCAN} recettes`)
    }

    const recipeId = await ctx.db.insert(
      'recipes',
      withSearchText({
        scanId,
        title: '',
        type: 'autre' as const,
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        status: 'review' as const,
        beautifiedAccepted: false,
        beautifyStatus: 'idle' as const,
        revision: 0,
      }),
    )
    await reconcileRetention(ctx, scanId)
    return { ok: true as const, recipeId }
  },
})

export const saveRecipe = mutation({
  args: {
    adminToken: v.string(),
    recipeId: v.id('recipes'),
    expectedRevision: v.number(),
    ...editableRecipe,
  },
  returns: okOrError,
  handler: async (
    ctx,
    { adminToken, recipeId, expectedRevision, ...fields },
  ) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return failed('Recette inconnue')
    if ((recipe.revision ?? 0) !== expectedRevision) {
      return failed(
        'Cette recette a changé depuis le chargement de l’écran : recharge avant d’enregistrer',
      )
    }
    if (recipe.status === 'published' && !publishableTitle(fields.title)) {
      return failed(
        'Une recette publiée doit garder un titre : dépublie-la d’abord',
      )
    }

    await ctx.db.patch(
      recipeId,
      withSearchText({ ...fields, revision: expectedRevision + 1 }),
    )
    return { ok: true as const }
  },
})

export const deleteRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return failed('Recette inconnue')
    if (recipe.status === 'published') {
      return failed('Dépublie la recette avant de la supprimer')
    }
    const { scanId } = recipe
    await ctx.db.delete(recipeId)
    await reconcileRetention(ctx, scanId)
    return { ok: true as const }
  },
})

export const publishRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return failed('Recette inconnue')
    const result = await publish(ctx, recipe)
    if (!result.ok) return result
    await reconcileRetention(ctx, recipe.scanId)
    return { ok: true as const }
  },
})

export const unpublishRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return failed('Recette inconnue')
    if (recipe.status === 'review') return { ok: true as const }
    // The slug stays: it is the address the storefront published, and reusing it for another
    // recipe would break the first one on republication.
    await ctx.db.patch(recipeId, {
      status: 'review',
      publishedAt: undefined,
      revision: (recipe.revision ?? 0) + 1,
    })
    await reconcileRetention(ctx, recipe.scanId)
    return { ok: true as const }
  },
})

export const publishScan = mutation({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      published: v.number(),
      // Named rather than counted: the operator has to know *which* drafts stayed behind, and why.
      refused: v.array(v.object({ title: v.string(), error: v.string() })),
    }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { adminToken, scanId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return failed('Scan inconnu')
    const recipes = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .take(MAX_RECIPES_PER_SCAN + 1)
    if (recipes.length > MAX_RECIPES_PER_SCAN) {
      return failed(
        `Ce scan porte plus de ${MAX_RECIPES_PER_SCAN} recettes : corrige-les une par une`,
      )
    }

    let published = 0
    const refused: { title: string; error: string }[] = []
    for (const recipe of recipes) {
      if (recipe.status === 'published') continue
      const result = await publish(ctx, recipe)
      if (result.ok) published += 1
      else refused.push({ title: recipe.title, error: result.error })
    }
    await reconcileRetention(ctx, scanId)
    return { ok: true as const, published, refused }
  },
})

export const acknowledgeImageChange = mutation({
  args: { adminToken: v.string(), scanId: v.id('scans') },
  returns: okOrError,
  handler: async (ctx, { adminToken, scanId }) => {
    requireAdmin(adminToken)
    const scan = await ctx.db.get('scans', scanId)
    if (!scan) return failed('Scan inconnu')
    await ctx.db.patch(scanId, { imagesChangedAt: undefined })
    return { ok: true as const }
  },
})
