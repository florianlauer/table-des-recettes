import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { requireAdmin } from './auth'
import { deleteStoredBlob } from './lib/blobs'
import {
  revisionOf,
  withIllustration,
  withSearchText,
} from './lib/recipeWrites'
import { clearAllRenditions } from './lib/renditions'
import { deleteRecipeDoc, insertRecipeDoc, patchRecipeDoc } from './recipeDocs'
import { okOrError, refuse, succeeded } from './lib/validators'
import type { Refusal } from './lib/validators'
import { reconcileRetention } from './retention'
import { ingredient, recipeType } from './schema'
import { slugify } from '../src/shared/slug'
import {
  MAX_RECIPES_PER_SCAN,
  SLUG_PROBE_LIMIT,
} from '../src/shared/scanLimits'

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
): Promise<{ ok: true; slug: string } | Refusal> {
  for (let suffix = 1; suffix <= SLUG_PROBE_LIMIT; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`
    if (!(await slugTaken(ctx, candidate))) return { ok: true, slug: candidate }
  }
  const fallback = `${base}-${recipeId}`
  if (await slugTaken(ctx, fallback)) {
    return refuse('Impossible de dériver une adresse unique pour ce titre')
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

/**
 * Takes the verdict rather than fetching it: `publishScan` already holds the scan, and re-reading it
 * once per recipe made the loop pay for a fact that is the same for all of them.
 */
async function publish(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  imagesChanged: boolean,
): Promise<{ ok: true } | Refusal> {
  if (recipe.status === 'published') return succeeded
  if (!publishableTitle(recipe.title)) {
    return refuse(
      `« ${recipe.title || 'Sans titre'} » n’a pas de titre publiable`,
    )
  }
  if (imagesChanged) {
    return refuse(
      'Les images du scan ont changé depuis l’extraction : relis ou relance avant de publier',
    )
  }

  // Frozen once and never recomputed: a title corrected after publication must not move the URL
  // the storefront already handed out.
  let slug = recipe.slug
  if (!slug) {
    const resolved = await resolveSlug(ctx, recipe._id, slugify(recipe.title))
    if (!resolved.ok) return resolved
    slug = resolved.slug
  }
  await patchRecipeDoc(ctx, recipe, {
    status: 'published',
    slug,
    publishedAt: Date.now(),
    revision: revisionOf(recipe) + 1,
  })
  return succeeded
}

async function imagesChangedFor(
  ctx: MutationCtx,
  scanId: Id<'scans'> | undefined,
): Promise<boolean> {
  if (!scanId) return false
  const scan = await ctx.db.get('scans', scanId)
  return scan?.imagesChangedAt !== undefined
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
    if (!scan) return refuse('Scan inconnu')
    const existing = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .take(MAX_RECIPES_PER_SCAN)
    if (existing.length >= MAX_RECIPES_PER_SCAN) {
      return refuse(`Ce scan porte déjà ${MAX_RECIPES_PER_SCAN} recettes`)
    }

    const recipeId = await insertRecipeDoc(
      ctx,
      withIllustration(
        withSearchText({
          scanId,
          title: '',
          type: 'autre' as const,
          ingredients: [],
          ingredientsInferred: false,
          steps: [],
          status: 'review' as const,
          imageStorageId: undefined,
          beautifiedAccepted: false,
          noPhotoAvailable: false,
          beautifyStatus: 'idle' as const,
          revision: 0,
        }),
        Date.now(),
      ),
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
    if (!recipe) return refuse('Recette inconnue')
    if (revisionOf(recipe) !== expectedRevision) {
      return refuse(
        'Cette recette a changé depuis le chargement de l’écran : recharge avant d’enregistrer',
      )
    }
    if (recipe.status === 'published' && !publishableTitle(fields.title)) {
      return refuse(
        'Une recette publiée doit garder un titre : dépublie-la d’abord',
      )
    }

    // `fields` carries `type`, one of the two keys the counts aggregate is namespaced on.
    await patchRecipeDoc(
      ctx,
      recipe,
      withSearchText({ ...fields, revision: expectedRevision + 1 }),
    )
    return succeeded
  },
})

export const deleteRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return refuse('Recette inconnue')
    if (recipe.status === 'published') {
      return refuse('Dépublie la recette avant de la supprimer')
    }
    // Deleting the row used to leave every blob it referenced behind: an orphan for the photo, one
    // for the beautified candidate, and — since renditions exist — one for each derivative. Nothing
    // references them afterwards, so nothing can ever collect them.
    const { scanId } = recipe
    for (const storageId of [
      recipe.imageStorageId,
      recipe.beautifiedStorageId,
    ]) {
      if (storageId) await deleteStoredBlob(ctx, storageId)
    }
    await clearAllRenditions(ctx, recipe)
    await deleteRecipeDoc(ctx, recipe)
    await reconcileRetention(ctx, scanId)
    return succeeded
  },
})

export const publishRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return refuse('Recette inconnue')
    const imagesChanged = await imagesChangedFor(ctx, recipe.scanId)
    const result = await publish(ctx, recipe, imagesChanged)
    if (!result.ok) return result
    await reconcileRetention(ctx, recipe.scanId)
    return succeeded
  },
})

export const unpublishRecipe = mutation({
  args: { adminToken: v.string(), recipeId: v.id('recipes') },
  returns: okOrError,
  handler: async (ctx, { adminToken, recipeId }) => {
    requireAdmin(adminToken)
    const recipe = await loadRecipe(ctx, recipeId)
    if (!recipe) return refuse('Recette inconnue')
    if (recipe.status === 'review') return succeeded
    // The slug stays: it is the address the storefront published, and reusing it for another
    // recipe would break the first one on republication.
    await patchRecipeDoc(ctx, recipe, {
      status: 'review',
      publishedAt: undefined,
      revision: revisionOf(recipe) + 1,
    })
    await reconcileRetention(ctx, recipe.scanId)
    return succeeded
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
    if (!scan) return refuse('Scan inconnu')
    const recipes = await ctx.db
      .query('recipes')
      .withIndex('by_scan', (q) => q.eq('scanId', scanId))
      .take(MAX_RECIPES_PER_SCAN + 1)
    if (recipes.length > MAX_RECIPES_PER_SCAN) {
      return refuse(
        `Ce scan porte plus de ${MAX_RECIPES_PER_SCAN} recettes : corrige-les une par une`,
      )
    }

    const imagesChanged = scan.imagesChangedAt !== undefined
    let published = 0
    const refused: { title: string; error: string }[] = []
    for (const recipe of recipes) {
      if (recipe.status === 'published') continue
      const result = await publish(ctx, recipe, imagesChanged)
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
    if (!scan) return refuse('Scan inconnu')
    await ctx.db.patch(scanId, { imagesChangedAt: undefined })
    return succeeded
  },
})
