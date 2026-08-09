import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const recipeType = v.union(
  v.literal("entree"),
  v.literal("plat"),
  v.literal("dessert"),
  v.literal("apero"),
  v.literal("petitDej"),
  v.literal("autre"),
);

export const ingredient = v.object({
  raw: v.string(),
  quantity: v.optional(v.number()),
  unit: v.optional(v.string()),
  label: v.optional(v.string()),
});

export default defineSchema({
  scans: defineTable({
    imageStorageIds: v.array(v.id("_storage")),
    status: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("done"),
      v.literal("failed"),
    ),
    attemptId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    attempts: v.number(),
    error: v.optional(v.string()),
    purgeAfter: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_purge_after", ["purgeAfter"]),

  recipes: defineTable({
    scanId: v.optional(v.id("scans")),
    title: v.string(),
    slug: v.optional(v.string()),
    type: recipeType,
    servings: v.optional(v.number()),
    ingredients: v.array(ingredient),
    steps: v.array(v.string()),
    searchText: v.string(),
    status: v.union(v.literal("review"), v.literal("published")),
    publishedAt: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    beautifiedStorageId: v.optional(v.id("_storage")),
    beautifiedAccepted: v.boolean(),
    beautifyStatus: v.union(
      v.literal("idle"),
      v.literal("generating"),
      v.literal("review"),
      v.literal("failed"),
    ),
    beautifyAttemptId: v.optional(v.string()),
    beautifyError: v.optional(v.string()),
  })
    .index("by_status_type", ["status", "type"])
    .index("by_slug", ["slug"])
    .index("by_scan", ["scanId"])
    .searchIndex("search_recipes", {
      searchField: "searchText",
      filterFields: ["status", "type"],
    }),
});
