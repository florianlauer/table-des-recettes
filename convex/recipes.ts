import { v } from "convex/values";
import type { Infer } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ingredient, recipeType } from "./schema";
import { RECIPE_TYPES } from "../src/lib/recipeTypes";
import { toSearchQuery } from "../src/lib/normalize";
import { findMatchingIngredient } from "../src/lib/matchReason";
import { pickDisplayImage } from "../src/lib/displayImage";

type StorageCtx = Pick<QueryCtx, "storage">;

/**
 * Une ligne d'index. `matchedIngredient` répond à « pourquoi cette ligne est là » :
 * hors recherche, ou quand le titre suffit à l'expliquer, la réponse est `null`. Le champ
 * est donc toujours présent — c'est ce qui permet à `browse` de n'avoir qu'une seule forme.
 * `slug` y est obligatoire — voir ADR 0001.
 */
export const publishedRecipeRow = v.object({
  id: v.string(),
  title: v.string(),
  slug: v.string(),
  type: recipeType,
  imageUrl: v.union(v.string(), v.null()),
  matchedIngredient: v.union(v.string(), v.null()),
});

export type PublishedRecipeRow = Infer<typeof publishedRecipeRow>;

export const publishedRecipe = v.object({
  ...publishedRecipeRow.fields,
  servings: v.union(v.number(), v.null()),
  ingredients: v.array(ingredient),
  steps: v.array(v.string()),
});

/**
 * Énuméré à la main plutôt que dérivé de `RECIPE_TYPES` : le handler construit un
 * `Record<RecipeType, number>`, donc un type ajouté d'un côté et pas de l'autre casse
 * la compilation. La dérive est attrapée sans rendre le validateur illisible.
 */
const typeCounts = v.object({
  total: v.number(),
  byType: v.object({
    entree: v.number(),
    plat: v.number(),
    dessert: v.number(),
    apero: v.number(),
    petitDej: v.number(),
    autre: v.number(),
  }),
});

async function imageUrl(ctx: StorageCtx, doc: Doc<"recipes">): Promise<string | null> {
  const picked = pickDisplayImage({
    imageStorageId: doc.imageStorageId ?? null,
    beautifiedStorageId: doc.beautifiedStorageId ?? null,
    beautifiedAccepted: doc.beautifiedAccepted,
  });
  return picked ? ctx.storage.getUrl(picked.storageId) : null;
}

/**
 * Franchit la frontière brouillon → recette publiée. Une recette publiée sans slug est
 * un invariant rompu : on lève plutôt que de fabriquer un lien mort (ADR 0001).
 */
async function toRow(
  ctx: StorageCtx,
  doc: Doc<"recipes">,
  tokens: string,
): Promise<PublishedRecipeRow> {
  if (!doc.slug) {
    throw new Error(`Recette publiée sans slug : ${doc._id}`);
  }
  return {
    id: doc._id,
    title: doc.title,
    slug: doc.slug,
    type: doc.type,
    imageUrl: await imageUrl(ctx, doc),
    matchedIngredient: tokens
      ? findMatchingIngredient(doc.title, doc.ingredients, tokens)
      : null,
  };
}

/**
 * L'unique lecture de l'index. La bascule liste ↔ recherche vit ici, du côté qui la
 * possède : une requête vide n'est pas un mode séparé, c'est l'absence de filtre textuel.
 */
export const browse = query({
  args: { query: v.optional(v.string()), type: v.optional(recipeType) },
  returns: v.array(publishedRecipeRow),
  handler: async (ctx, { query: rawQuery, type }) => {
    const tokens = toSearchQuery(rawQuery ?? "");

    const docs = tokens
      ? await ctx.db
          .query("recipes")
          .withSearchIndex("search_recipes", (s) => {
            const base = s.search("searchText", tokens).eq("status", "published");
            return type ? base.eq("type", type) : base;
          })
          .take(1024)
      : await ctx.db
          .query("recipes")
          .withIndex("by_status_type", (q) => {
            const base = q.eq("status", "published");
            return type ? base.eq("type", type) : base;
          })
          .collect();

    return Promise.all(docs.map((doc) => toRow(ctx, doc, tokens)));
  },
});

export const countsByType = query({
  args: {},
  returns: typeCounts,
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("recipes")
      .withIndex("by_status_type", (q) => q.eq("status", "published"))
      .collect();
    // Compteur exhaustif sur l'union fermée : un type sans recette vaut 0, il ne
    // disparaît pas de la forme. La ligne de filtres n'a donc pas à deviner.
    const byType = Object.fromEntries(RECIPE_TYPES.map((t) => [t, 0])) as Record<
      Doc<"recipes">["type"],
      number
    >;
    for (const row of rows) byType[row.type] += 1;
    return { total: rows.length, byType };
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publishedRecipe, v.null()),
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!doc || doc.status !== "published") return null;
    // Le type de sortie n'expose que ce dont la vitrine a besoin : les champs
    // d'administration (scanId, beautifyAttemptId, beautifyError) ne partent jamais au client.
    return {
      ...(await toRow(ctx, doc, "")),
      servings: doc.servings ?? null,
      ingredients: doc.ingredients,
      steps: doc.steps,
    };
  },
});
