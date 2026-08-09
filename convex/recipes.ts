import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { recipeType } from "./schema";
import { toSearchQuery } from "../src/lib/normalize";
import { findMatchingIngredient } from "../src/lib/matchReason";
import { pickDisplayImage } from "../src/lib/displayImage";

type StorageCtx = Pick<QueryCtx, "storage">;

/** Une recette publiée telle que la vitrine la voit. `slug` y est obligatoire — voir ADR 0001. */
export type PublishedRecipeSummary = {
  id: string;
  title: string;
  slug: string;
  type: Doc<"recipes">["type"];
  imageUrl: string | null;
};

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
async function toSummary(ctx: StorageCtx, doc: Doc<"recipes">): Promise<PublishedRecipeSummary> {
  if (!doc.slug) {
    throw new Error(`Recette publiée sans slug : ${doc._id}`);
  }
  return {
    id: doc._id,
    title: doc.title,
    slug: doc.slug,
    type: doc.type,
    imageUrl: await imageUrl(ctx, doc),
  };
}

export const listPublished = query({
  args: { type: v.optional(recipeType) },
  handler: async (ctx, { type }) => {
    const rows = type
      ? await ctx.db
          .query("recipes")
          .withIndex("by_status_type", (q) => q.eq("status", "published").eq("type", type))
          .collect()
      : await ctx.db
          .query("recipes")
          .withIndex("by_status_type", (q) => q.eq("status", "published"))
          .collect();
    return Promise.all(rows.map((doc) => toSummary(ctx, doc)));
  },
});

export const countsByType = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("recipes")
      .withIndex("by_status_type", (q) => q.eq("status", "published"))
      .collect();
    const byType: Record<string, number> = {};
    for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1;
    return { total: rows.length, byType };
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("recipes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!doc || doc.status !== "published") return null;
    // Le type de sortie n'expose que ce dont la vitrine a besoin : les champs
    // d'administration (scanId, beautifyAttemptId, beautifyError) ne partent jamais au client.
    return {
      ...(await toSummary(ctx, doc)),
      servings: doc.servings ?? null,
      ingredients: doc.ingredients,
      steps: doc.steps,
    };
  },
});

export const search = query({
  args: { query: v.string(), type: v.optional(recipeType) },
  handler: async (ctx, { query: rawQuery, type }) => {
    const tokens = toSearchQuery(rawQuery);
    if (!tokens) return [];
    const rows = await ctx.db
      .query("recipes")
      .withSearchIndex("search_recipes", (s) => {
        const base = s.search("searchText", tokens).eq("status", "published");
        return type ? base.eq("type", type) : base;
      })
      .take(1024);
    return Promise.all(
      rows.map(async (doc) => ({
        ...(await toSummary(ctx, doc)),
        matchedIngredient: findMatchingIngredient(doc.title, doc.ingredients, tokens),
      })),
    );
  },
});
